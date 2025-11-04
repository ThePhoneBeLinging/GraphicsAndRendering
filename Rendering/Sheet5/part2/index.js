async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) { fail('need a browser that supports WebGPU'); return; }

    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat });

    //const wgslCode = document.querySelector('script[type="x-shader/x-wgsl"]').textContent;
    const wgslCode = await (await fetch('./index.wgsl')).text();
    const module = device.createShaderModule({ code: wgslCode });

    const vertices = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    vertexBuffer.unmap();

    function compute_jitters(jitter, pixelsize, subdivs)
    {
        const step = pixelsize/subdivs;
        if(subdivs < 2) {
            jitter[0] = 0.0;
            jitter[1] = 0.0;
        }
        else {
            for(var i = 0; i < subdivs; ++i)
                for(var j = 0; j < subdivs; ++j) {
                    const idx = (i*subdivs + j)*2;
                    jitter[idx] = (Math.random() + j)*step - pixelsize*0.5;
                    jitter[idx + 1] = (Math.random() + i)*step - pixelsize*0.5;
                }
        }
    }

    // Load teapot mesh
    const obj_filename = '../objects/teapot.obj';
    const obj = await readOBJFile(obj_filename, 1, true);

    const positionBuffer = device.createBuffer({
        size: obj.vertices.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
    });
    device.queue.writeBuffer(positionBuffer, 0, obj.vertices);

    const indexBuffer = device.createBuffer({
        size: obj.indices.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
    });
    device.queue.writeBuffer(indexBuffer, 0, obj.indices);

    let subdivLevel = 1;
    const subdivValue = document.getElementById('subdiv-value');
    const subdivInc = document.getElementById('subdiv-inc');
    const subdivDec = document.getElementById('subdiv-dec');

    let textureScalingLevel = 1;
    const textureScalingValue = document.getElementById('texture-scaling-value');
    const textureScalingInc = document.getElementById('texture-scaling-inc');
    const textureScalingDec = document.getElementById('texture-scaling-dec');

    let jitter = new Float32Array(200);
    const jitterBuffer = device.createBuffer({
        size: jitter.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
    });

    const cameraConstantSlider = document.getElementById('zoom');
    const cameraConstantValue = document.getElementById('zoom-value');
    const gammaSlider = document.getElementById('gamma');
    const gammaValue = document.getElementById('gamma-value');
    const addressModeDropdown = document.getElementById('filter-mode');
    const filterMode = document.getElementById('sunday');
    const useTexture = document.getElementById('use-texture');

    var cameraConstant = parseFloat(cameraConstantValue.value);
    var gamma = parseFloat(gammaValue.value);
    gamma = 2.4;
    cameraConstant = 2.5;

    cameraConstantSlider.addEventListener('input', () => {
        cameraConstant = parseFloat(cameraConstantSlider.value);
        cameraConstantValue.textContent = cameraConstant.toFixed(2);
        uniformData[1] = cameraConstant;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });
    gammaSlider.addEventListener('input', () => {
        gamma = parseFloat(gammaSlider.value);
        gammaValue.textContent = gamma.toFixed(2);
        uniformData[16] = gamma;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });

    addressModeDropdown.addEventListener('change', () => {
        let value = addressModeDropdown.value;
        uniformData[2] = value === "repeat" ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });
    filterMode.addEventListener('change', () => {
        let filterModeValue = filterMode.value;
        uniformData[3] = filterModeValue === 'nearest' ? 0 : 1;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });

    let aspectRatio = canvas.width / canvas.height;
    useTexture.checked = true;

    useTexture.addEventListener('change', () => {
        uniformData[7] = useTexture.checked ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });

    const eye = [0.15, 1.5, 10.0];
    const at = [0.15, 1.5, 0.0];
    const up = [0.0, 1.0, 0.0];

    const uniformData = new Float32Array(20);
    uniformData[0] = aspectRatio;
    uniformData[1] = cameraConstant;
    uniformData[2] = 0;
    uniformData[3] = 0;
    uniformData[4] = eye[0];
    uniformData[5] = eye[1];
    uniformData[6] = eye[2];
    uniformData[7] = 1;             
    uniformData[8] = up[0];
    uniformData[9] = up[1];
    uniformData[10] = up[2];
    uniformData[11] = textureScalingLevel;
    uniformData[12] = at[0];
    uniformData[13] = at[1];
    uniformData[14] = at[2];
    uniformData[15] = 1;
    uniformData[16] = gamma;
    uniformData[17] = 0;
    uniformData[18] = 0;
    uniformData[19] = 0;

    const uniformBuffer = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    const texture = await load_texture(device, 'grass.jpg');

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        ]
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 8,
                attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }]
            }]
        },
        fragment: {
            module,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    const renderPassDescriptor = {
        colorAttachments: [{ clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store' }],
    };


    let bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: { buffer: jitterBuffer } },
            { binding: 3, resource: { buffer: positionBuffer } },
            { binding: 4, resource: { buffer: indexBuffer } },
        ],
    });


    subdivInc.addEventListener('click', () => {
        subdivLevel = Math.min(subdivLevel + 1, 10);
        subdivValue.textContent = subdivLevel;
        updateJitterBuffer();
        render();
    });
    subdivDec.addEventListener('click', () => {
        subdivLevel = Math.max(subdivLevel - 1, 1);
        subdivValue.textContent = subdivLevel;
        updateJitterBuffer();
        render();
    });

    function updateTextureScaling() {
        textureScalingValue.textContent = textureScalingLevel;
        uniformData[11] = textureScalingLevel;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    }

    textureScalingInc.addEventListener('click', () => {
        textureScalingLevel = Math.min(textureScalingLevel + 1, 10);
        updateTextureScaling()
    });
    textureScalingDec.addEventListener('click', () => {
        textureScalingLevel = Math.max(textureScalingLevel - 1, 1);
        updateTextureScaling()
    });

    function updateJitterBuffer() {
        const pixelSizeNDC = 2 / canvas.height;
        compute_jitters(jitter, pixelSizeNDC, subdivLevel);

        const vecCount = subdivLevel * subdivLevel;
        uniformData[15] = vecCount;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // Upload just what we filled (vecCount * 2 floats)
        const byteLength = vecCount * 2 * 4;
        device.queue.writeBuffer(jitterBuffer, 0, jitter, 0, byteLength / 4);
    }


    function render() {
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    }

    async function load_texture(device, filename) {
        const response = await fetch(filename);
        const blob = await response.blob();
        const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        const texture = device.createTexture({
            size: [img.width, img.height, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        device.queue.copyExternalImageToTexture(
            { source: img, flipY: true },
            { texture: texture },
            { width: img.width, height: img.height },
        );
        return texture;
    }

    addEventListener("wheel", (event) => {
        cameraConstant *= 1.0 + 2.5e-4*event.deltaY;
        uniformData[1] = cameraConstant;
        requestAnimationFrame(animate);
    });

    updateJitterBuffer();
    animate();
}

function fail(msg) { alert(msg); }
window.addEventListener("load", main);
