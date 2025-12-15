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

    function compute_jitters(jitter, pixelsize, subdivs) {
        const step = pixelsize / subdivs;
        if (subdivs < 2) {
            jitter[0] = 0.0;
            jitter[1] = 0.0;
        } else {
            for (let i = 0; i < subdivs; ++i)
                for (let j = 0; j < subdivs; ++j) {
                    const idx = (i * subdivs + j) * 2;
                    jitter[idx] = (Math.random() + j) * step - pixelsize * 0.5;
                    jitter[idx + 1] = (Math.random() + i) * step - pixelsize * 0.5;
                }
        }
    }

    const MODEL_PRESETS = {
        teapot: {
            file: '../objects/teapot.obj',
            eye: [0.15, 1.5, 10.0],
            at: [0.15, 1.5, 0.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 2.5,
        },
        bunny: {
            file: '../objects/bunny.obj',
            eye: [-0.02, 0.11, 0.6],
            at: [-0.02, 0.11, 0.0],
            up: [0.0, 1.0, 0.0],
            cameraConstant: 3.5,
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
    const shadingModeSelect = document.getElementById('shading-mode');

    let buffers = {};
    let currentModel = 'teapot';
    let aspectRatio = canvas.width / canvas.height;
    let cameraConstant = parseFloat(cameraConstantValue.value);
    let gamma = parseFloat(gammaSlider.value);
    cameraConstant = 1.0;
    if (gammaValue) {
        gammaValue.textContent = gamma.toFixed(2);
    }

    const eye = [277.0, 275.0, -570.0];
    const at = [277.0, 275.0, 0.0];
    const up = [0.0, 1.0, 0.0];

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
    uniformData[17] = 0;
    uniformData[18] = canvas.width;
    uniformData[19] = canvas.height;
    uniformData[20] = 0.0;
    uniformData[21] = 0;
    uniformData[22] = 0;
    uniformData[23] = 0; 

    let frameNumber = 0;
    let progressiveEnabled = true;
    let useBlueBackground = false;
    let shadingMode = 0;

    const uniformBuffer = device.createBuffer({
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    uniformData[20] = useBlueBackground ? 1.0 : 0.0;
    uniformData[21] = shadingMode;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const texture = await load_texture(device, '../../../luxo_pxr_campus.jpg');

    const textures = {
        width: canvas.width,
        height: canvas.height
    };
    
    textures.renderSrc = device.createTexture({
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        format: 'rgba32float',
    });
    
    textures.renderDst = device.createTexture({
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        format: 'rgba32float',
    });

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
            { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
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
            targets: [
                { format: presentationFormat },
                { format: 'rgba32float' }
            ]
        },
        primitive: { topology: 'triangle-strip' }
    });

    const renderPassDescriptor = {
        colorAttachments: [{ clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
    };

    let bindGroup;

    function resetFrameCounter() {
        frameNumber = 0;
    }

    cameraConstantSlider.addEventListener('input', () => {
        cameraConstant = parseFloat(cameraConstantSlider.value);
        cameraConstantValue.textContent = cameraConstant.toFixed(2);
        uniformData[1] = cameraConstant;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    gammaSlider.addEventListener('input', () => {
        gamma = parseFloat(gammaSlider.value);
        gammaValue.textContent = gamma.toFixed(2);
        uniformData[16] = gamma;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    addressModeDropdown.addEventListener('change', () => {
        const value = addressModeDropdown.value;
        uniformData[2] = value === "repeat" ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    filterMode.addEventListener('change', () => {
        const filterModeValue = filterMode.value;
        uniformData[3] = filterModeValue === 'nearest' ? 0 : 1;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    useTexture.checked = true;
    useTexture.addEventListener('change', () => {
        uniformData[7] = useTexture.checked ? 1 : 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    subdivInc.addEventListener('click', () => {
        subdivLevel = Math.min(subdivLevel + 1, 10);
        subdivValue.textContent = subdivLevel;
        updateJitterBuffer();
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    subdivDec.addEventListener('click', () => {
        subdivLevel = Math.max(subdivLevel - 1, 1);
        subdivValue.textContent = subdivLevel;
        updateJitterBuffer();
        resetFrameCounter();
        if (!progressiveEnabled) render();
    });

    function updateTextureScaling() {
        textureScalingValue.textContent = textureScalingLevel;
        uniformData[11] = textureScalingLevel;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        resetFrameCounter();
        if (!progressiveEnabled) render();
    }

    textureScalingInc.addEventListener('click', () => {
        textureScalingLevel = Math.min(textureScalingLevel + 1, 10);
        updateTextureScaling();
    });

    textureScalingDec.addEventListener('click', () => {
        textureScalingLevel = Math.max(textureScalingLevel - 1, 1);
        updateTextureScaling();
    });
    
    const progressiveCheckbox = document.getElementById('progressive-rendering');
    if (progressiveCheckbox) {
        progressiveCheckbox.checked = progressiveEnabled;
        progressiveCheckbox.addEventListener('change', () => {
            progressiveEnabled = progressiveCheckbox.checked;
            resetFrameCounter();
            if (progressiveEnabled) {
                render();
            }
        });
    }

    const blueBackgroundCheckbox = document.getElementById('blue-background');
    if (blueBackgroundCheckbox) {
        blueBackgroundCheckbox.checked = useBlueBackground;
        blueBackgroundCheckbox.addEventListener('change', () => {
            useBlueBackground = blueBackgroundCheckbox.checked;
            uniformData[20] = useBlueBackground ? 1.0 : 0.0;
            device.queue.writeBuffer(uniformBuffer, 0, uniformData);
            resetFrameCounter();
            if (progressiveEnabled) {
                render();
            } else {
                render();
            }
        });
    }

    if (shadingModeSelect) {
        shadingModeSelect.value = 'base';
        shadingModeSelect.addEventListener('change', () => {
            const value = shadingModeSelect.value;
            shadingMode = value === 'mirror' ? 1 : value === 'diffuse' ? 2 : 0;
            uniformData[21] = shadingMode;
            device.queue.writeBuffer(uniformBuffer, 0, uniformData);
            resetFrameCounter();
            if (!progressiveEnabled) {
                render();
            }
        });
    }

    addEventListener("wheel", (event) => {
        cameraConstant *= 1.0 + 2.5e-4 * event.deltaY;
        uniformData[1] = cameraConstant;
        resetFrameCounter();
        if (!progressiveEnabled) {
            requestAnimationFrame(animate);
        }
    });

    function updateJitterBuffer() {
        const pixelSizeNDC = 2 / canvas.height;
        compute_jitters(jitter, pixelSizeNDC, subdivLevel);
        const vecCount = subdivLevel * subdivLevel;
        uniformData[15] = vecCount;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        const byteLength = vecCount * 2 * 4;
        device.queue.writeBuffer(jitterBuffer, 0, jitter, 0, byteLength / 4);
    }

    function render() {
        if (progressiveEnabled) {
            uniformData[17] = frameNumber;
            frameNumber++;
        } else {
            uniformData[17] = 0;
            frameNumber = 0;
        }
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        
        const encoder = device.createCommandEncoder();
        const pass = timingHelper.beginRenderPass(encoder, {
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                },
                {
                    view: textures.renderSrc.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                }
            ]
        });
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();

        encoder.copyTextureToTexture(
            { texture: textures.renderSrc },
            { texture: textures.renderDst },
            [textures.width, textures.height]
        );

        device.queue.submit([encoder.finish()]);
        timingHelper.getResult().then(time => {
            gpuTime = time / 1000;
            if (gpuTimeDisplay) gpuTimeDisplay.textContent = gpuTime.toFixed(3) + ' ms';
        });
        
        if (progressiveEnabled) {
            requestAnimationFrame(render);
        }
    }

    function animate() {
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        if (!progressiveEnabled) render();
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
            { source: img, flipY: false },
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
                { binding: 11, resource: textures.renderDst.createView() },
            ],
        });

        resetFrameCounter();
        render();
    }

    updateJitterBuffer();
    await loadModelAndRebind('teapot');
    if (modelSelect) {
        modelSelect.value = 'teapot';
        modelSelect.addEventListener('change', async (e) => {
            await loadModelAndRebind(e.target.value);
        });
    }

    animate();
}

function fail(msg) { alert(msg); }

window.addEventListener("load", main);
