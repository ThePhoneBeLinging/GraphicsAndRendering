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
        vec3(-2.0, -1.0, -1.0),
        vec3(2.0, -1.0, -1.0),
        vec3(2.0, -1.0, -5.0),
        vec3(-2.0, -1.0, -5.0),
    ];
    const groundIndices = [0, 1, 2, 0, 2, 3];

    const redQuad1Positions = [
        vec3(0.25, -0.5, -1.25),
        vec3(0.75, -0.5, -1.25),
        vec3(0.75, -0.5, -1.75),
        vec3(0.25, -0.5, -1.75),
    ];
    const redQuad1Indices = [4, 5, 6, 4, 6, 7];

    const redQuad2Positions = [
        vec3(-1.0, -1.0, -2.5),
        vec3(-1.0, 0.0, -2.5),
        vec3(-1.0, 0.0, -3.0),
        vec3(-1.0, -1.0, -3.0),
    ];
    const redQuad2Indices = [8, 9, 10, 8, 10, 11];

    const positions = [...groundPositions, ...redQuad1Positions, ...redQuad2Positions];
    const indices = [...groundIndices, ...redQuad1Indices, ...redQuad2Indices];

    const groundTexcoords = [
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
    ];

    // Dummy texcoords for red quads
    const redQuadTexcoords = [
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    ];

    const texcoords = new Float32Array([...groundTexcoords, ...redQuadTexcoords]);

    let indexData = new Uint32Array(indices);
    let positionData = flatten(positions);

    var vertexBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, positionData);

    var texCoordBuffer = device.createBuffer({
        size: texcoords.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(texCoordBuffer, 0, texcoords);

    var indexBuffer = device.createBuffer({
        size: indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indexData);

    // Placeholder for xamp23.png
    const groundTexture = await (async () => {
        try {
            const response = await fetch('xamp23.png');
            const blob = await response.blob();
            const source = await createImageBitmap(blob);
            const texture = device.createTexture({
                size: [source.width, source.height, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            device.queue.copyExternalImageToTexture(
                { source },
                { texture },
                [source.width, source.height]
            );
            return texture;
        } catch (e) {
            console.error("Could not load xamp23.png, using checkerboard texture instead.", e);
            const texSize = 64;
            const checker = new Uint8Array(texSize * texSize * 4);
            for (let y = 0; y < texSize; ++y) {
                for (let x = 0; x < texSize; ++x) {
                    const xs = Math.floor(x / (texSize / 8));
                    const ys = Math.floor(y / (texSize / 8));
                    const v = ((xs + ys) % 2) === 0 ? 0 : 255;
                    const idx = (y * texSize + x) * 4;
                    checker[idx] = v;
                    checker[idx + 1] = v;
                    checker[idx + 2] = v;
                    checker[idx + 3] = 255;
                }
            }
            const texture = device.createTexture({
                size: { width: texSize, height: texSize, depthOrArrayLayers: 1 },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            device.queue.writeTexture(
                { texture: texture },
                checker,
                { bytesPerRow: texSize * 4 },
                { width: texSize, height: texSize, depthOrArrayLayers: 1 }
            );
            return texture;
        }
    })();


    const redTexture = device.createTexture({
        size: { width: 1, height: 1, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
        { texture: redTexture },
        new Uint8Array([255, 0, 0, 255]),
        { bytesPerRow: 4 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
    );

    const sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    // positions
                    arrayStride: 12, // 3 * 4
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
                {
                    // texcoords
                    arrayStride: 8, // 2 * 4
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
                },
            ],
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format }],
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'none',
        },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    const shadowPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    // positions
                    arrayStride: 12, // 3 * 4
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
                {
                    // texcoords
                    arrayStride: 8, // 2 * 4
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
                },
            ],
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format }],
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'none',
        },
        depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const uniformBuffer = device.createBuffer({
        size: 128, // mat4 + f32 with padding
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const groundBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer, size: 80 } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: groundTexture.createView() },
        ],
    });

    const redBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer, size: 80 } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: redTexture.createView() },
        ],
    });

    const aspect =
        (canvas.clientWidth || canvas.width || 1) / (canvas.clientHeight || canvas.height || 1);
    const projGL = perspective(90.0, aspect, 0.1, 100.0);
    const view = lookAt(vec3(0, 1, 0), vec3(0, 0, -2.5), vec3(0, 1, 0));
    function mvpFor(model) {
        return mult(projGL, mult(view, model));
    }

    const model = mat4();

    const lightPosition = vec3(0, 0, 0);
    const shadowProjection = mat4();

    function updateShadowProjection(lightPos) {
        const plane = vec4(0, 1, 0, 1); // y = -1 plane
        const light = vec4(lightPos[0], lightPos[1], lightPos[2], 1.0);
        const dotVar = dot(plane, light);
        const m = mat4();
        m[0][0] = dotVar - light[0] * plane[0];
        m[0][1] = -light[0] * plane[1];
        m[0][2] = -light[0] * plane[2];
        m[0][3] = -light[0] * plane[3];

        m[1][0] = -light[1] * plane[0];
        m[1][1] = dotVar - light[1] * plane[1];
        m[1][2] = -light[1] * plane[2];
        m[1][3] = -light[1] * plane[3];

        m[2][0] = -light[2] * plane[0];
        m[2][1] = -light[2] * plane[1];
        m[2][2] = dotVar - light[2] * plane[2];
        m[2][3] = -light[2] * plane[3];

        m[3][0] = -light[3] * plane[0];
        m[3][1] = -light[3] * plane[1];
        m[3][2] = -light[3] * plane[2];
        m[3][3] = dotVar - light[3] * plane[3];

        for(let i=0; i<4; ++i) {
            for(let j=0; j<4; ++j) {
                shadowProjection[i][j] = m[i][j];
            }
        }
    }

    const uniformData = new Float32Array(16 * 2); // mvp and visibility
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const renderPass = {
        colorAttachments: [{
            view: undefined,
            clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: undefined,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        }
    };

    function render(time) {
        time *= 0.001; // convert time to seconds

        // Animate light
        lightPosition[0] = 0 + 2 * Math.cos(time);
        lightPosition[1] = 2;
        lightPosition[2] = -2 + 2 * Math.sin(time);

        updateShadowProjection(lightPosition);

        renderPass.colorAttachments[0].view = context.getCurrentTexture().createView();
        renderPass.depthStencilAttachment.view = depthTexture.createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPass);

        pass.setVertexBuffer(0, vertexBuffer);
        pass.setVertexBuffer(1, texCoordBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');

        // Draw ground
        pass.setPipeline(pipeline);
        uniformData.set(flatten(mvpFor(model)));
        uniformData.set([1.0], 16); // visibility = 1.0
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(groundIndices.length, 1, 0, 0, 0);

        // Draw red quads' shadows
        pass.setPipeline(shadowPipeline);
        const shadowModel = mult(shadowProjection, model);
        uniformData.set(flatten(mvpFor(shadowModel)));
        uniformData.set([0.0], 16); // visibility = 0.0 (black)
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        pass.setBindGroup(0, redBindGroup);
        pass.drawIndexed(redQuad1Indices.length, 1, groundIndices.length, 0, 0);
        pass.drawIndexed(redQuad2Indices.length, 1, groundIndices.length + redQuad1Indices.length, 0, 0);

        // Draw red quads
        pass.setPipeline(pipeline);
        uniformData.set(flatten(mvpFor(model)));
        uniformData.set([1.0], 16); // visibility = 1.0
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        pass.setBindGroup(0, redBindGroup);
        pass.drawIndexed(redQuad1Indices.length, 1, groundIndices.length, 0, 0);
        pass.drawIndexed(redQuad2Indices.length, 1, groundIndices.length + redQuad1Indices.length, 0, 0);

        pass.end();
        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

window.addEventListener('load', main);


