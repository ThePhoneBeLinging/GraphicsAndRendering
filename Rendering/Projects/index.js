async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const canTimestamp = adapter.features.has('timestamp-query');
    const device = await adapter.requestDevice({
        requiredFeatures: [
            ...(canTimestamp ? ['timestamp-query'] : []),
        ],
    });
    if (!device) { fail('need a browser that supports WebGPU'); return; }

    const timingHelper = new TimingHelper(device);
    let gpuTime = 0;
    const gpuTimeDisplay = document.getElementById('gpu-time');

    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat });

    const wgslCode = await (await fetch('./index.wgsl')).text();
    const module = device.createShaderModule({ code: wgslCode });

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    vertexBuffer.unmap();

    function compute_jitters(jitter, subdivs) {
        const step = 1.0 / subdivs;
        for (let i = 0; i < subdivs; ++i) {
            for (let j = 0; j < subdivs; ++j) {
                const idx = (i * subdivs + j) * 2;
                jitter[idx]     = (j + Math.random()) * step;
                jitter[idx + 1] = (i + Math.random()) * step;
            }
        }
    }

    const MODEL_PRESETS = {
        teapot: {
            file: 'objects/teapot.obj',
            eye: [0.15, 1.5, 10.0],
            at: [0.15, 1.5, 0.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 2.5,
        },
        bunny: {
            file: 'objects/bunny.obj',
            eye: [-0.02, 0.11, 0.6],
            at: [-0.02, 0.11, 0.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 3.5,
        },
        cornellbox: {
            file: 'objects/CornellBox.obj',
            eye: [277.0, 275.0, -570.0],
            at: [277.0, 275.0, 0.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 1.0,
        },
        cornellbox_lens_showcase: {
            file: 'objects/CornellBox.obj',
            eye: [220.0, 200.0, -250.0],
            at: [220.0, 200.0, 200.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 1.5,
        },
    };

    let subdivLevel = 2;
    const subdivValue = document.getElementById('subdiv-value');
    const subdivInc = document.getElementById('subdiv-inc');
    const subdivDec = document.getElementById('subdiv-dec');

    let textureScalingLevel = 1;
    const textureScalingValue = document.getElementById('texture-scaling-value');
    const textureScalingInc = document.getElementById('texture-scaling-inc');
    const textureScalingDec = document.getElementById('texture-scaling-dec');

    const cameraConstantSlider = document.getElementById('zoom');
    const cameraConstantValue = document.getElementById('zoom-value');
    const gammaSlider = document.getElementById('gamma');
    const gammaValue = document.getElementById('gamma-value');
    const addressModeDropdown = document.getElementById('filter-mode');
    const filterMode = document.getElementById('sunday');
    const useTexture = document.getElementById('use-texture');
    const modelSelect = document.getElementById('model');
    const focusSlider = document.getElementById('focus-distance');
    const focusValue = document.getElementById('focus-distance-value');
    const apertureSlider = document.getElementById('aperture');
    const apertureValue = document.getElementById('aperture-value');

    let buffers = {};
    let currentModel = 'teapot';
    let aspectRatio = canvas.width / canvas.height;
    let cameraConstant = parseFloat(cameraConstantValue.value);
    let gamma = parseFloat(gammaValue.value) || 1.4;
    cameraConstant = 1.0;

    const eye = [277.0, 275.0, -570.0];
    const at = [277.0, 275.0, 0.0];
    const up = [0.0, 1.0, 0.0];

    let focusDistance = 926.0;
    let lensRadius = 24.0;

    const uniformData = new Float32Array(24);
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
    uniformData[17] = focusDistance;
    uniformData[18] = lensRadius;
    uniformData[19] = 0;
    uniformData[20] = 0;
    uniformData[21] = 0;
    uniformData[22] = 0;
    uniformData[23] = 0;

    const uniformBuffer = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    const texture = await load_texture(device, 'grass.jpg');

    let jitter = new Float32Array(200);
    const jitterBuffer = device.createBuffer({
        size: jitter.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },          
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },     
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 7, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 9, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, 
            { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },          
        ],
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
        colorAttachments: [{ clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
    };

    let bindGroup;

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
        const value = addressModeDropdown.value;
        uniformData[2] = value === "repeat" ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });

    filterMode.addEventListener('change', () => {
        const filterModeValue = filterMode.value;
        uniformData[3] = filterModeValue === 'nearest' ? 0 : 1;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    });

    useTexture.checked = true;
    useTexture.addEventListener('change', () => {
        uniformData[7] = useTexture.checked ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
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
        updateTextureScaling();
    });

    textureScalingDec.addEventListener('click', () => {
        textureScalingLevel = Math.max(textureScalingLevel - 1, 1);
        updateTextureScaling();
    });

    if (focusSlider && focusValue) {
        const updateFocus = (value) => {
            focusDistance = value;
            focusValue.textContent = value.toFixed(1);
            uniformData[17] = focusDistance;
            device.queue.writeBuffer(uniformBuffer, 0, uniformData);
            render();
        };
        focusSlider.addEventListener('input', () => {
            updateFocus(parseFloat(focusSlider.value));
        });
        updateFocus(parseFloat(focusSlider.value));
    }

    if (apertureSlider && apertureValue) {
        const updateAperture = (value) => {
            lensRadius = value;
            apertureValue.textContent = value.toFixed(2);
            uniformData[18] = lensRadius;
            device.queue.writeBuffer(uniformBuffer, 0, uniformData);
            render();
        };
        apertureSlider.addEventListener('input', () => {
            updateAperture(parseFloat(apertureSlider.value));
        });
        updateAperture(parseFloat(apertureSlider.value));
    }

    addEventListener("wheel", (event) => {
        cameraConstant *= 1.0 + 2.5e-4 * event.deltaY;
        uniformData[1] = cameraConstant;
        requestAnimationFrame(animate);
    });

    function updateJitterBuffer() {
        compute_jitters(jitter, subdivLevel);
        const vecCount = subdivLevel * subdivLevel;
        uniformData[15] = vecCount;          // jitterVectorCount
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        const byteLength = vecCount * 2 * 4;
        device.queue.writeBuffer(jitterBuffer, 0, jitter, 0, byteLength / 4);
    }

    function render() {
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = timingHelper.beginRenderPass(encoder, {
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                storeOp: "store",
            }]
        });
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();

        device.queue.submit([encoder.finish()]);
        timingHelper.getResult().then(time => {
            gpuTime = time / 1000;
            if (gpuTimeDisplay) gpuTimeDisplay.textContent = gpuTime.toFixed(3) + ' ms';
        });
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

    async function loadModelAndRebind(key) {
        currentModel = key;
        const preset = MODEL_PRESETS[key];

        const obj = await readOBJFile(preset.file, 1, true);
        buffers = {};
        build_bsp_tree(obj, device, buffers);

        const mat_bytelength = obj.materials.length * 2 * 16;
        const materials = new ArrayBuffer(mat_bytelength);
        for (let i = 0; i < obj.materials.length; ++i) {
            const mat = obj.materials[i];
            const emission = [
                mat.emission ? mat.emission.r : 0.0,
                mat.emission ? mat.emission.g : 0.0,
                mat.emission ? mat.emission.b : 0.0,
                0.0
            ];
            const diffuse = [
                mat.color ? mat.color.r : 0.8,
                mat.color ? mat.color.g : 0.8,
                mat.color ? mat.color.b : 0.8,
                0.0
            ];
            new Float32Array(materials, i * 2 * 16, 8).set([...emission, ...diffuse]);
        }
        buffers.materials = device.createBuffer({
            size: mat_bytelength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(buffers.materials, 0, materials);

        buffers.lightIndices = device.createBuffer({
            size: Math.max(obj.light_indices.byteLength, 4),
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
        });
        device.queue.writeBuffer(buffers.lightIndices, 0, obj.light_indices);

        const { eye, at, up, cameraConstant: cc } = preset;
        uniformData[4] = eye[0];
        uniformData[5] = eye[1];
        uniformData[6] = eye[2];
        uniformData[12] = at[0];
        uniformData[13] = at[1];
        uniformData[14] = at[2];
        uniformData[8] = up[0];
        uniformData[9] = up[1];
        uniformData[10] = up[2];
        uniformData[1] = cc;

        cameraConstant = cc;
        if (cameraConstantSlider) cameraConstantSlider.value = String(cc);
        if (cameraConstantValue) cameraConstantValue.textContent = cc.toFixed(2);
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: texture.createView() },
                { binding: 2, resource: { buffer: jitterBuffer } },
                { binding: 3, resource: { buffer: buffers.attribs } },  
                { binding: 4, resource: { buffer: buffers.indices } },   
                { binding: 5, resource: { buffer: buffers.materials } },
                { binding: 6, resource: { buffer: buffers.lightIndices } },
                { binding: 7, resource: { buffer: buffers.treeIds } },
                { binding: 8, resource: { buffer: buffers.bspTree } },
                { binding: 9, resource: { buffer: buffers.bspPlanes } },
                { binding: 10, resource: { buffer: buffers.aabb } },
            ],
        });

        render();
    }

    updateJitterBuffer();
    await loadModelAndRebind('cornellbox_lens_showcase');
    if (modelSelect) {
        modelSelect.value = 'cornellbox';
        const awesomeOption = document.createElement('option');
        awesomeOption.value = 'cornellbox_lens_showcase';
        awesomeOption.textContent = 'Cornell Box (Lens Showcase)';
        modelSelect.appendChild(awesomeOption);

        modelSelect.addEventListener('change', async (e) => {
            const key = e.target.value;
            if (MODEL_PRESETS[key]) {
                await loadModelAndRebind(key);
            }
        });
    }

    animate();
}

function fail(msg) { alert(msg); }

window.addEventListener("load", main);