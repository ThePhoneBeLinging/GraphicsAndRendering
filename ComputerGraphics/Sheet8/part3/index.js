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
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
        primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    function createUniformBuffer() {
        return device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    const staticUniformBuffer = createUniformBuffer();
    const shadowUniformBuffer = createUniformBuffer();

    const groundBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: staticUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: groundTexture.createView() },
        ],
    });

    const redBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: staticUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: redTexture.createView() },
        ],
    });

    const shadowBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: shadowUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: redTexture.createView() },
        ],
    });

    const aspect =
        (canvas.clientWidth || canvas.width || 1) / (canvas.clientHeight || canvas.height || 1);
    const projGL = perspective(90.0, aspect, 0.1, 100.0);
    const view = mat4();
    function mvpFor(model) {
        const zfix = mat4(
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0.5, 0.5,
            0, 0, 0, 1
        );
        return mult(zfix, mult(projGL, mult(view, model)));
    }

    const planeNormal = vec3(0.0, 1.0, 0.0);
    const planeD = 1.0;
    const shadowBias = translate(0.0, 0.01, 0.0);
    const baseModel = mat4();
    const lightCenter = vec3(0.0, 2.0, -2.0);
    const lightRadius = 2.0;
    const lightSpeed = 0.5;

    function getLightPosition(timeSeconds) {
        const angle = timeSeconds * lightSpeed;
        const x = lightCenter[0] + lightRadius * Math.cos(angle);
        const z = lightCenter[2] + lightRadius * Math.sin(angle);
        return vec4(x, lightCenter[1], z, 1.0);
    }

    function computeShadowMatrix(lightPos) {
        const a = planeNormal[0];
        const b = planeNormal[1];
        const c = planeNormal[2];
        const d = planeD;
        const lx = lightPos[0];
        const ly = lightPos[1];
        const lz = lightPos[2];
        const lw = lightPos[3];
        const dot = a * lx + b * ly + c * lz + d * lw;
        return mat4(
            dot - lx * a,    -lx * b,         -lx * c,         -lx * d,
            -ly * a,          dot - ly * b,    -ly * c,         -ly * d,
            -lz * a,          -lz * b,         dot - lz * c,    -lz * d,
            -lw * a,          -lw * b,         -lw * c,         dot - lw * d
        );
    }

    function createUniformValues() {
        const values = new Float32Array(24);
        values[17] = 0;
        values[18] = 0;
        values[19] = 0;
        return values;
    }

    const staticUniformValues = createUniformValues();
    const shadowUniformValues = createUniformValues();

    function writeUniforms(buffer, values, modelMatrix, visibility) {
        const mvp = mvpFor(modelMatrix);
        values.set(flatten(mvp), 0);
        values[16] = visibility;
        device.queue.writeBuffer(buffer, 0, values);
    }

    const renderPass = {
        colorAttachments: [{
            view: undefined,
            clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
    };

    function render(time = 0) {
        const timeSeconds = time * 0.001;
        const lightPosition = getLightPosition(timeSeconds);
        const shadowMatrix = computeShadowMatrix(lightPosition);
        const shadowModel = mult(shadowBias, mult(shadowMatrix, baseModel));

        writeUniforms(staticUniformBuffer, staticUniformValues, baseModel, 1.0);
        writeUniforms(shadowUniformBuffer, shadowUniformValues, shadowModel, 0.0);

        renderPass.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPass);

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setVertexBuffer(1, texCoordBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');

        // Draw ground
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(groundIndices.length, 1, 0, 0, 0);

        // Draw shadows before the actual geometry so they appear between the ground and the quads
        pass.setBindGroup(0, shadowBindGroup);
        pass.drawIndexed(redQuad1Indices.length, 1, groundIndices.length, 0, 0);
        pass.drawIndexed(redQuad2Indices.length, 1, groundIndices.length + redQuad1Indices.length, 0, 0);

        // Draw red quads last
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
