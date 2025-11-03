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

    var positions = [
        vec3(-4.0, -1.0, -1.0),
        vec3(4.0, -1.0, -1.0),
        vec3(4.0, -1.0, -21.0),
        vec3(-4.0, -1.0, -21.0),
    ];
    var indices = [0, 1, 2, 0, 2, 3]; // two triangles

    const texcoords = new Float32Array([
        -1.5, 0.0,
        2.5, 0.0,
        2.5, 10.0,
        -1.5, 10.0,
    ]);

    let indexData = new Uint32Array(indices);

    let positionData = flatten(positions);
    var vertexBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, positionData);

    // Texcoord buffer (separate vertex buffer slot)
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

    let texture = null;
    let sampler = null;
    let currentBindGroup = null;

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
        primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    const uniformBuffers = [0].map(() =>
        device.createBuffer({
            size: sizeof['mat4'],
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
    );

    function createResourcesFromUI() {
        const wrap = document.getElementById('wrapMode').value; // 'repeat' or 'clamp-to-edge'
        const minFilter = document.getElementById('minFilter').value; // 'nearest' or 'linear'
        const magFilter = document.getElementById('magFilter').value;
        const mipmapFilter = document.getElementById('mipmapFilter').value;
        const enableMipmaps = document.getElementById('enableMipmaps').checked;

        const mipLevelCount = enableMipmaps ? numMipLevels(texSize, texSize) : 1;

        texture = device.createTexture({
            size: { width: texSize, height: texSize, depthOrArrayLayers: 1 },
            mipLevelCount: mipLevelCount,
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (enableMipmaps ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
        });

        device.queue.writeTexture(
            { texture: texture, mipLevel: 0 },
            checker,
            { bytesPerRow: texSize * 4 },
            { width: texSize, height: texSize, depthOrArrayLayers: 1 }
        );


        if (enableMipmaps && mipLevelCount > 1) {
            generateMipmap(device, texture);
        }
        sampler = device.createSampler({
            addressModeU: wrap,
            addressModeV: wrap,
            magFilter: magFilter,
            minFilter: minFilter,
            mipmapFilter: mipmapFilter,
        });

        currentBindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffers[0] } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: texture.createView() },
            ],
        });
    }
    createResourcesFromUI();

    ['wrapMode', 'minFilter', 'magFilter', 'mipmapFilter', 'enableMipmaps'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            createResourcesFromUI();
            render();
        });
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

    const model = mat4();
    device.queue.writeBuffer(uniformBuffers[0], 0, flatten(mvpFor(model)));

    const renderPass = {
        colorAttachments: [{
            view: undefined,
            clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
    };

    function render() {
        renderPass.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPass);

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setVertexBuffer(1, texCoordBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');
        pass.setBindGroup(0, currentBindGroup);
        pass.drawIndexed(indices.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    render();
}

window.addEventListener('load', main);
