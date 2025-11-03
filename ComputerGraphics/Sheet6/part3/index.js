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


    const M_SQRT2 = Math.sqrt(2.0);
    const M_SQRT6 = Math.sqrt(6.0)
    var positions = [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 2.0*M_SQRT2/3.0, -1.0/3.0),
        vec3(-M_SQRT6/3.0, -M_SQRT2/3.0, -1.0/3.0),
        vec3(M_SQRT6/3.0, -M_SQRT2/3.0, -1.0/3.0),
    ];
    var indices = [
        0, 1, 2,
        0, 3, 1,
        1, 3, 2,
        0, 2, 3
    ];

    let newIndices = subdivide_sphere(positions, indices);

    let subdivLevel = 1;
    const subdivValue = document.getElementById('subdiv-value');
    const subdivInc = document.getElementById('subdiv-inc');
    const subdivDec = document.getElementById('subdiv-dec');



    subdivInc.addEventListener('click', () => {
        subdivLevel = Math.min(subdivLevel + 1, 10);
        subdivValue.textContent = subdivLevel;
        updateSubDiv();
        render();
    });
    subdivDec.addEventListener('click', () => {
        subdivLevel = Math.max(subdivLevel - 1, 1);
        subdivValue.textContent = subdivLevel;
        updateSubDiv();
        render();
    });

    let orbiting = true;
    const toggleOrbit = document.getElementById('orbit-toggle');
    toggleOrbit.textContent = orbiting ? 'Stop Orbit' : 'Start Orbit';

    var radius = 5;
    var angleAlpha = 0;

    toggleOrbit.addEventListener('click', () => {
        orbiting = !orbiting;
        toggleOrbit.textContent = orbiting ? 'Stop Orbit' : 'Start Orbit';
        animate();
    });

    for (let i = 0; i < subdivLevel; i++)
    {
        newIndices = subdivide_sphere(positions, newIndices);
    }
    let indexData = new Uint32Array(newIndices);

    let positionData = flatten(positions);
    var vertexBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, positionData);

    var indexBuffer = device.createBuffer({
        size: indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indexData);

    function updateSubDiv()
    {
        positions = [
            vec3(0.0, 0.0, 1.0),
            vec3(0.0, 2.0*M_SQRT2/3.0, -1.0/3.0),
            vec3(-M_SQRT6/3.0, -M_SQRT2/3.0, -1.0/3.0),
            vec3(M_SQRT6/3.0, -M_SQRT2/3.0, -1.0/3.0),
        ];
        newIndices = [
            0, 1, 2,
            0, 3, 1,
            1, 3, 2,
            0, 2, 3
        ];
        for (let i = 0; i < subdivLevel; i++)
        {
            newIndices = subdivide_sphere(positions, newIndices);
        }
        indexData = new Uint32Array(newIndices);
        positionData = flatten(positions);

        vertexBuffer = device.createBuffer({
            size: positionData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, positionData);

        indexBuffer = device.createBuffer({
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(indexBuffer, 0, indexData);
    }

    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const imgBitmap = await (async () => {
        const resp = await fetch('./earth.jpg');
        if (!resp.ok) throw new Error('Failed to load earth.jpg');
        const blob = await resp.blob();
        return await createImageBitmap(blob);
    })();

    const texWidth = imgBitmap.width;
    const texHeight = imgBitmap.height;
    const mipLevelCount = Math.floor(Math.log2(Math.max(texWidth, texHeight))) + 1;

    const earthTexture = device.createTexture({
        size: [texWidth, texHeight, 1],
        mipLevelCount: mipLevelCount,
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: imgBitmap },
        { texture: earthTexture, mipLevel: 0 },
        [texWidth, texHeight]
    );

    const earthSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
    });

    const blitWgsl = `
    @group(0) @binding(0) var srcTex: texture_2d<f32>;
    @group(0) @binding(1) var srcSampler: sampler;

    struct VertOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

    @vertex
    fn vs(@builtin(vertex_index) vid: u32) -> VertOut {
        var pos = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(3.0, -1.0),
            vec2<f32>(-1.0, 3.0)
        );
        var uv = array<vec2<f32>,3>(
            vec2<f32>(0.0, 0.0),
            vec2<f32>(2.0, 0.0),
            vec2<f32>(0.0, 2.0)
        );
        var out: VertOut;
        out.pos = vec4<f32>(pos[vid], 0.0, 1.0);
        out.uv = uv[vid];
        return out;
    }

    @fragment
    fn fs(in: VertOut) -> @location(0) vec4<f32> {
        return textureSample(srcTex, srcSampler, in.uv);
    }
    `;

    const blitModule = device.createShaderModule({ code: blitWgsl });

    const blitPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: blitModule, entryPoint: 'vs', buffers: [] },
        fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
    });

    const blitBindGroupLayout = blitPipeline.getBindGroupLayout(0);

    for (let level = 1; level < mipLevelCount; ++level) {
        const srcView = earthTexture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
        const dstView = earthTexture.createView({ baseMipLevel: level, mipLevelCount: 1 });

        const blitBindGroup = device.createBindGroup({
            layout: blitBindGroupLayout,
            entries: [
                { binding: 0, resource: srcView },
                { binding: 1, resource: earthSampler },
            ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(blitPipeline);
        pass.setBindGroup(0, blitBindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
    });

    const pipeline = device.createRenderPipeline({
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus'
        },
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [{
                arrayStride: 12, // 3 * 4 bytes
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            }],
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', frontFace: "ccw" ,cullMode: 'back' },
    });

    const uniformBuffers = [0].map(() =>
        device.createBuffer({
            size: sizeof['mat4'],
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
    );

    // Create bind groups with uniform + texture + sampler
    const bindGroups = uniformBuffers.map(buf =>
        device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buf } },
                { binding: 1, resource: earthTexture.createView() },
                { binding: 2, resource: earthSampler },
            ],
        })
    );

    const aspect =
        (canvas.clientWidth || canvas.width || 1) / (canvas.clientHeight || canvas.height || 1);
    const projGL = perspective(45.0, aspect, 0.1, 100.0);

    const zfix = mat4(
        1,0,0,0,
        0,1,0,0,
        0,0,0.5,0.5,
        0,0,0,1
    );
    const eye = vec3(radius * Math.sin(angleAlpha), 0, radius * Math.cos(angleAlpha));
    const at  = vec3(0,0,0);
    const up  = vec3(0, 1, 0);
    var view = lookAt(eye, at, up);

    const baseModel = translate(0, 0, 0);

    function mvpFor(model) {
        return mult(zfix, mult(projGL, mult(view, model)));
    }

    const modelOnePoint =
        mult(translate(0.0, 0.0, 0.0),
            mult(rotateX(-20), mult(rotateY(35), baseModel)));

    device.queue.writeBuffer(uniformBuffers[0], 0, flatten(mvpFor(modelOnePoint)));

    const renderPass = {
        colorAttachments: [{
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthLoadOp: "clear",
            depthClearValue: 1.0,
            depthStoreOp: "store",

        }
    };

    function subdivide_sphere(positions, indices)
    {
        var triangles = indices.length / 3;
        var new_indices = [];
        for (var i = 0; i < triangles; i++)
        {
            var i0 = indices[i*3];
            var i1 = indices[i*3 + 1];
            var i2 = indices[i*3 + 2];
            var c01 = positions.length;
            var c12 = c01 + 1;
            var c20 = c12 + 1;
            positions.push(normalize(add(positions[i0], positions[i1])));
            positions.push(normalize(add(positions[i1], positions[i2])));
            positions.push(normalize(add(positions[i2], positions[i0])));
            new_indices.push(i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2);
        }

        return new_indices;
    }



    function render() {
        renderPass.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPass);

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');
        for (let i = 0; i < 1; ++i) {
            pass.setBindGroup(0, bindGroups[i]);
            pass.drawIndexed(indexData.length);
        }

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        if (!orbiting) return;
        angleAlpha += 0.1;
        const eye = vec3(radius * Math.sin(angleAlpha), 0, radius * Math.cos(angleAlpha));
        const at  = vec3(0,0,0);
        const up  = vec3(0, 1, 0);
        view = lookAt(eye, at, up);

        const baseModel = translate(0, 0, 0);

        const modelOnePoint =
            mult(translate(0.0, 0.0, 0.0),
                mult(rotateX(-20), mult(rotateY(35), baseModel)));

        device.queue.writeBuffer(uniformBuffers[0], 0, flatten(mvpFor(modelOnePoint)));
        render();
        // Start animation loop if orbiting
        if (orbiting) requestAnimationFrame(animate);
    }

    render();
}

window.addEventListener('load', main);
