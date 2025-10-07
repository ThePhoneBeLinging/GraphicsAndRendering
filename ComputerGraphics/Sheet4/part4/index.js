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

    const wire_indices = new Uint32Array([
        0, 1, 1, 2, 2, 3, 3, 0, // front
        2, 3, 3, 7, 7, 6, 6, 2, // right
        0, 3, 3, 7, 7, 4, 4, 0, // down
        1, 2, 2, 6, 6, 5, 5, 1, // up
        4, 5, 5, 6, 6, 7, 7, 4, // back
        0, 1, 1, 5, 5, 4, 4, 0  // left
    ]);

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

    let orbiting = false;
    const toggleOrbit = document.getElementById('orbit-toggle');
    toggleOrbit.textContent = orbiting ? 'Stop Orbit' : 'Start Orbit';

    var radius = 5;
    var angleAlpha = 0;

    toggleOrbit.addEventListener('click', () => {
        orbiting = !orbiting;
        toggleOrbit.textContent = orbiting ? 'Stop Orbit' : 'Start Orbit';
        animate();
    });

    var leSliderValue = 1.0;
    var laSliderValue = 0.5;
    var kdSliderValue = 0.7;
    var ksSliderValue = 0.5;
    var sSliderValue = 10.0;
    
    const leSlider = document.getElementById('le-slider');
    const laSlider = document.getElementById('la-slider');
    const kdSlider = document.getElementById('kd-slider');
    const ksSlider = document.getElementById('ks-slider');
    const sSlider = document.getElementById('s-slider');

    leSlider.addEventListener('input', () => {
        leSliderValue = parseFloat(leSlider.value);
        uniformValues[16] = leSliderValue;
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render();
    });

    laSlider.addEventListener('input', () => {
        laSliderValue = parseFloat(laSliderValue);
        uniformValues[17] = laSliderValue;
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render();
    });

    kdSlider.addEventListener('input', () => {
        kdSliderValue = parseFloat(kdSlider.value);
        uniformValues[18] = kdSliderValue;
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render()
    });

    ksSlider.addEventListener('input', () => {
        ksSliderValue = parseFloat(ksSlider.value);
        uniformValues[19] = ksSliderValue;
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render();
    });

    sSlider.addEventListener('input', () => {
        sSliderValue = parseFloat(sSlider.value);
        uniformValues[20] = sSliderValue;
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render();
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

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });

    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
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

    var uniformValues = new Float32Array(24);

    const uniformBuffer =
        device.createBuffer({
            size: 112,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

    const bindGroup =
        device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });

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

    let flatModelOnePoint = flatten(mvpFor(modelOnePoint));
    for (let i = 0; i < flatModelOnePoint.length; i++)
    {
        uniformValues[i] = flatModelOnePoint[i];
    }
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPass = {
        colorAttachments: [{
            clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
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
            var i0 = indices[i*3+0];
            var i1 = indices[i*3+1];
            var i2 = indices[i*3+2];
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
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indexData.length);

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
        let flatModelOnePoint = flatten(mvpFor(modelOnePoint));
        for (let i = 0; i < flatModelOnePoint.length; i++)
        {
            uniformValues[i] = flatModelOnePoint[i];
        }
        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
        render();
        requestAnimationFrame(animate)
    }

    render();
}

window.addEventListener('load', main);
