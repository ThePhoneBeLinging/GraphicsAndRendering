async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
        alert('need a browser that supports WebGPU');
        return;
    }

    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const wgslCode = await (await fetch('./index.wgsl')).text();
    const module = device.createShaderModule({ code: wgslCode });

    const groundPositions = [
        vec3(-2.5, -1.0, -1.0),
        vec3(2.5, -1.0, -1.0),
        vec3(2.5, -1.0, -6.0),
        vec3(-2.5, -1.0, -6.0),
    ];
    const groundIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const groundTexcoords = new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
    ]);

    const positionData = flatten(groundPositions);
    const groundPositionBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(groundPositionBuffer, 0, positionData);

    const groundTexcoordBuffer = device.createBuffer({
        size: groundTexcoords.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(groundTexcoordBuffer, 0, groundTexcoords);

    const groundIndexBuffer = device.createBuffer({
        size: groundIndices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(groundIndexBuffer, 0, groundIndices);

    const groundTexture = await loadTexture(device, 'xamp23.png');
    const sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
    });

    const groundUniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const teapotUniformBuffer = device.createBuffer({
        size: 160,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const groundBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
    });

    const teapotBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
    });

    const groundBindGroup = device.createBindGroup({
        layout: groundBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: groundTexture.createView() },
        ],
    });

    const teapotBindGroup = device.createBindGroup({
        layout: teapotBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: teapotUniformBuffer } }],
    });

    const depthFormat = 'depth24plus';
    let depthTexture = null;
    let depthTextureView = null;
    const depthSize = { width: 0, height: 0 };
    function updateDepthTexture() {
        const width = canvas.clientWidth || canvas.width || 1;
        const height = canvas.clientHeight || canvas.height || 1;
        if (width === depthSize.width && height === depthSize.height && depthTextureView) {
            return;
        }
        depthSize.width = width;
        depthSize.height = height;
        depthTexture = device.createTexture({
            size: [width, height, 1],
            format: depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        depthTextureView = depthTexture.createView();
    }
    updateDepthTexture();

    const groundPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [groundBindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'ground_vs',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
                {
                    arrayStride: 8,
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
                },
            ],
        },
        fragment: {
            module,
            entryPoint: 'ground_fs',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            format: depthFormat,
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    const teapotPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [groundBindGroupLayout, teapotBindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'teapot_vs',
            buffers: [
                {
                    arrayStride: 24,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    ],
                },
            ],
        },
        fragment: {
            module,
            entryPoint: 'teapot_fs',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            format: depthFormat,
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    const teapotMesh = await loadTeapotMesh(device);
    if (!teapotMesh) {
        alert('Failed to load teapot mesh.');
        return;
    }

    const toggleButton = document.getElementById('toggle-jump');
    let jumping = true;
    const updateToggleLabel = () => {
        if (toggleButton) {
            toggleButton.textContent = jumping ? 'Pause Jump' : 'Resume Jump';
        }
    };
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            jumping = !jumping;
            updateToggleLabel();
        });
        updateToggleLabel();
    }

    const aspect = (canvas.clientWidth || canvas.width || 1) / (canvas.clientHeight || canvas.height || 1);
    const projection = perspective(90.0, aspect, 0.1, 100.0);
    const view = mat4();
    const zFix = mat4(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 0.5, 0.5,
        0, 0, 0, 1
    );
    const computeMVP = (model) => mult(zFix, mult(projection, mult(view, model)));

    const groundUniformData = new Float32Array(16);
    groundUniformData.set(flatten(computeMVP(mat4())));
    device.queue.writeBuffer(groundUniformBuffer, 0, groundUniformData);

    const teapotUniformData = new Float32Array(40);
    const eyeVec = new Float32Array([0.0, 0.0, 0.0, 1.0]);

    const teapotScale = scalem(0.25, 0.25, 0.25);
    const bounceMin = -1.0;
    const bounceMax = 0.5;
    const bounceMid = (bounceMin + bounceMax) * 0.5;
    const bounceAmp = (bounceMax - bounceMin) * 0.5;
    const bounceSpeed = 1.5;

    const lightCenter = vec3(0.0, 2.0, -2.0);
    const lightRadius = 2.0;
    const lightSpeed = 0.5;
    function getLightPosition(timeSeconds) {
        const angle = timeSeconds * lightSpeed;
        const x = lightCenter[0] + lightRadius * Math.cos(angle);
        const z = lightCenter[2] + lightRadius * Math.sin(angle);
        return vec4(x, lightCenter[1], z, 1.0);
    }

    const renderPassDescriptor = {
        colorAttachments: [{
            view: undefined,
            clearValue: { r: 0.2, g: 0.3, b: 0.5, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTextureView,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    };

    function render(time = 0) {
        const seconds = time * 0.001;
        const yOffset = jumping ? bounceMid + bounceAmp * Math.sin(seconds * bounceSpeed) : bounceMin;
        const model = mult(translate(0.0, yOffset, -3.0), teapotScale);
        const mvp = computeMVP(model);
        const lightPos = getLightPosition(seconds);

        teapotUniformData.set(flatten(mvp), 0);
        teapotUniformData.set(flatten(model), 16);
        teapotUniformData.set(lightPos, 32);
        teapotUniformData.set(eyeVec, 36);
        device.queue.writeBuffer(teapotUniformBuffer, 0, teapotUniformData);

        updateDepthTexture();
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        renderPassDescriptor.depthStencilAttachment.view = depthTextureView;

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPassDescriptor);

        pass.setPipeline(groundPipeline);
        pass.setVertexBuffer(0, groundPositionBuffer);
        pass.setVertexBuffer(1, groundTexcoordBuffer);
        pass.setIndexBuffer(groundIndexBuffer, 'uint16');
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(groundIndices.length);

        pass.setPipeline(teapotPipeline);
        pass.setVertexBuffer(0, teapotMesh.vertexBuffer);
        pass.setBindGroup(0, groundBindGroup);
        pass.setBindGroup(1, teapotBindGroup);
        pass.draw(teapotMesh.vertexCount);

        pass.end();
        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);

    async function loadTexture(device, filename) {
        try {
            const response = await fetch(filename);
            const blob = await response.blob();
            const image = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
            const texture = device.createTexture({
                size: [image.width, image.height, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            device.queue.copyExternalImageToTexture(
                { source: image, flipY: true },
                { texture },
                { width: image.width, height: image.height }
            );
            return texture;
        } catch (error) {
            console.warn('Falling back to checkerboard texture:', error);
            const texSize = 64;
            const checker = new Uint8Array(texSize * texSize * 4);
            for (let y = 0; y < texSize; ++y) {
                for (let x = 0; x < texSize; ++x) {
                    const cell = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0 ? 220 : 120;
                    const idx = (y * texSize + x) * 4;
                    checker[idx + 0] = cell;
                    checker[idx + 1] = cell;
                    checker[idx + 2] = cell;
                    checker[idx + 3] = 255;
                }
            }
            const texture = device.createTexture({
                size: [texSize, texSize, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            device.queue.writeTexture(
                { texture },
                checker,
                { bytesPerRow: texSize * 4 },
                { width: texSize, height: texSize, depthOrArrayLayers: 1 }
            );
            return texture;
        }
    }

    async function loadTeapotMesh(device) {
        const obj = await readOBJFile('../teapot/teapot.obj', 1, true);
        if (!obj) {
            return null;
        }
        const vertexStorage = obj.vertices;
        const normalStorage = obj.normals;
        const indexStorage = obj.indices;
        const faceCount = obj.mat_indices.length;
        const floatsPerVertex = 6;
        const vertices = new Float32Array(faceCount * 3 * floatsPerVertex);
        let cursor = 0;
        let dst = 0;
        for (let face = 0; face < faceCount; ++face) {
            for (let i = 0; i < 3; ++i) {
                const idx = indexStorage[cursor++];
                const base = idx * 4;
                vertices[dst++] = vertexStorage[base + 0];
                vertices[dst++] = vertexStorage[base + 1];
                vertices[dst++] = vertexStorage[base + 2];
                vertices[dst++] = normalStorage[base + 0];
                vertices[dst++] = normalStorage[base + 1];
                vertices[dst++] = normalStorage[base + 2];
            }
            cursor++; // skip material index per face
        }

        const vertexBuffer = device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, vertices);
        return { vertexBuffer, vertexCount: vertices.length / floatsPerVertex };
    }
}

window.addEventListener('load', main);
