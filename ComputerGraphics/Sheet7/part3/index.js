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

    const bgVertices = new Float32Array([
        -1, -1, 0.9999,
        1, -1, 0.9999,
        -1, 1, 0.9999,
        1, 1, 0.9999,
    ]);

    const bgIndices = new Uint32Array([0, 1, 2, 2, 1, 3]);

    const bgVertexBuffer = device.createBuffer({
        size: bgVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(bgVertexBuffer, 0, bgVertices);

    const bgIndexBuffer = device.createBuffer({
        size: bgIndices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(bgIndexBuffer, 0, bgIndices);

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

    const cubemap = [
        'cm_right.png',
        'cm_left.png',
        'cm_top.png',
        'cm_bottom.png',
        'cm_front.png',
        'cm_back.png'
    ];

    const imgs = await Promise.all(
        cubemap.map(async (filename) => {
            const resp = await fetch(`./${filename}`);
            if (!resp.ok) throw new Error(`Failed to load ${filename}`);
            const blob = await resp.blob();
            return await createImageBitmap(blob);
        })
    );

    const cubeTexture = device.createTexture({
        size: [imgs[0].width, imgs[0].height, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    for (let i = 0; i < 6; i++) {
        device.queue.copyExternalImageToTexture(
            { source: imgs[i], flipY: true },
            { texture: cubeTexture, origin: [0, 0, i] },
            [imgs[i].width, imgs[i].height]
        );
    }

    const cubeSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
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
                arrayStride: 12,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            }],
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', frontFace: "ccw" ,cullMode: 'none' },
    });

    const uniformBuffers = [0, 1].map(() =>
        device.createBuffer({
            size: sizeof['mat4'] * 3 + 16, // 3 matrices, 1 vec3f (padded), 1 u32
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
    );

    const bindGroups = uniformBuffers.map(buf =>
        device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buf } },
                { binding: 1, resource: cubeTexture.createView({dimension: 'cube'}) },
                { binding: 2, resource: cubeSampler },
            ],
        })
    );

    const aspect =
        (canvas.clientWidth || canvas.width || 1) / (canvas.clientHeight || canvas.height || 1);
    const proj = perspective(45.0, aspect, 0.1, 100.0);

    const zfix = mat4(
        1,0,0,0,
        0,1,0,0,
        0,0,0.5,0.5,
        0,0,0,1
    );
    const projGL = mult(zfix, proj);

    const eye = vec3(radius * Math.sin(angleAlpha), 0, radius * Math.cos(angleAlpha));
    const at  = vec3(0,0,0);
    const up  = vec3(0, 1, 0);
    let view = lookAt(eye, at, up);

    const baseModel = translate(0, 0, 0);

    function mvpFor(model) {
        return mult(projGL, mult(view, model));
    }

    const modelOnePoint =
        mult(translate(0.0, 0.0, 0.0),
            mult(rotateX(-20), mult(rotateY(35), baseModel)));

    const uniformDataSphere = new Float32Array(sizeof['mat4'] * 3 / 4 + 4);
    uniformDataSphere.set(flatten(mvpFor(modelOnePoint)));
    uniformDataSphere.set(flatten(modelOnePoint), sizeof['mat4'] / 4);
    uniformDataSphere.set(flatten(mat4()), sizeof['mat4'] * 2 / 4);
    uniformDataSphere.set(flatten(eye), sizeof['mat4'] * 3 / 4);
    const uniformDataSphereU32 = new Uint32Array(uniformDataSphere.buffer);
    uniformDataSphereU32[sizeof['mat4'] * 3 / 4 + 3] = 1;
    device.queue.writeBuffer(uniformBuffers[0], 0, uniformDataSphere);

    const invProj = inverse(proj);
    const viewRot = mat4(...flatten(view));
    viewRot[0][3] = 0;
    viewRot[1][3] = 0;
    viewRot[2][3] = 0;
    const invViewRot = inverse(viewRot);
    const texMatrix = mult(invViewRot, invProj);

    const uniformDataBg = new Float32Array(sizeof['mat4'] * 3 / 4 + 4);
    uniformDataBg.set(flatten(mat4()));
    uniformDataBg.set(flatten(mat4()), sizeof['mat4'] / 4);
    uniformDataBg.set(flatten(texMatrix), sizeof['mat4'] * 2 / 4);
    const uniformDataBgU32 = new Uint32Array(uniformDataBg.buffer);
    uniformDataBgU32[sizeof['mat4'] * 3 / 4 + 3] = 0;
    device.queue.writeBuffer(uniformBuffers[1], 0, uniformDataBg);


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

        pass.setBindGroup(0, bindGroups[1]);
        pass.setVertexBuffer(0, bgVertexBuffer);
        pass.setIndexBuffer(bgIndexBuffer, 'uint32');
        pass.drawIndexed(bgIndices.length);

        pass.setBindGroup(0, bindGroups[0]);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');
        pass.drawIndexed(indexData.length);


        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        if (!orbiting) return;
        angleAlpha += 0.01;
        const eye = vec3(radius * Math.sin(angleAlpha), 0, radius * Math.cos(angleAlpha));
        const at  = vec3(0,0,0);
        const up  = vec3(0, 1, 0);
        view = lookAt(eye, at, up);

        const baseModel = translate(0, 0, 0);

        const modelOnePoint =
            mult(translate(0.0, 0.0, 0.0),
                mult(rotateX(-20), mult(rotateY(35), baseModel)));

        const uniformDataSphere = new Float32Array(sizeof['mat4'] * 3 / 4 + 4);
        uniformDataSphere.set(flatten(mvpFor(modelOnePoint)));
        uniformDataSphere.set(flatten(modelOnePoint), sizeof['mat4'] / 4);
        uniformDataSphere.set(flatten(mat4()), sizeof['mat4'] * 2 / 4);
        uniformDataSphere.set(flatten(eye), sizeof['mat4'] * 3 / 4);
        const uniformDataSphereU32 = new Uint32Array(uniformDataSphere.buffer);
        uniformDataSphereU32[sizeof['mat4'] * 3 / 4 + 3] = 1;
        device.queue.writeBuffer(uniformBuffers[0], 0, uniformDataSphere);

        const invProj = inverse(proj);
        const viewRot = mat4(...flatten(view));
        viewRot[0][3] = 0;
        viewRot[1][3] = 0;
        viewRot[2][3] = 0;
        const invViewRot = inverse(viewRot);
        const texMatrix = mult(invViewRot, invProj);

        const uniformDataBg = new Float32Array(sizeof['mat4'] * 3 / 4 + 4);
        uniformDataBg.set(flatten(mat4()));
        uniformDataBg.set(flatten(mat4()), sizeof['mat4'] / 4);
        uniformDataBg.set(flatten(texMatrix), sizeof['mat4'] * 2 / 4);
        const uniformDataBgU32 = new Uint32Array(uniformDataBg.buffer);
        uniformDataBgU32[sizeof['mat4'] * 3 / 4 + 3] = 0;
        device.queue.writeBuffer(uniformBuffers[1], 0, uniformDataBg);

        render();
        if (orbiting) requestAnimationFrame(animate);
    }

    animate();
}

window.addEventListener('load', main);
