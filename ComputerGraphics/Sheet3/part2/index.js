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

    const positions = [
        vec3(0.0, 0.0, 1.0), // v0
        vec3(0.0, 1.0, 1.0), // v1
        vec3(1.0, 1.0, 1.0), // v2
        vec3(1.0, 0.0, 1.0), // v3
        vec3(0.0, 0.0, 0.0), // v4
        vec3(0.0, 1.0, 0.0), // v5
        vec3(1.0, 1.0, 0.0), // v6
        vec3(1.0, 0.0, 0.0), // v7
    ];

    const wire_indices = new Uint32Array([
        0, 1, 1, 2, 2, 3, 3, 0, // front
        2, 3, 3, 7, 7, 6, 6, 2, // right
        0, 3, 3, 7, 7, 4, 4, 0, // down
        1, 2, 2, 6, 6, 5, 5, 1, // up
        4, 5, 5, 6, 6, 7, 7, 4, // back
        0, 1, 1, 5, 5, 4, 4, 0  // left
    ]);

    const positionData = flatten(positions);
    const vertexBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, positionData);

    const indexBuffer = device.createBuffer({
        size: wire_indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, wire_indices);

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const pipeline = device.createRenderPipeline({
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
        primitive: { topology: 'line-list', cullMode: 'none' },
    });

    const uniformBuffers = [0, 1, 2].map(() =>
        device.createBuffer({
            size: sizeof['mat4'],
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
    );

    const bindGroups = uniformBuffers.map(buf =>
        device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: buf } }],
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
    const eye = vec3(0,0, 10);
    const at  = vec3(0,0, 0);
    const up  = vec3(0, 1, 0);
    const view = lookAt(eye, at, up);

    const baseModel = translate(-0.5, -0.5, -0.5);

    function mvpFor(model) {
        return mult(zfix, mult(projGL, mult(view, model)));
    }

    const modelOnePoint =
        mult(translate(-3.0, 0.0, 0.0), baseModel);

    const modelTwoPoint =
        mult(translate(0.0, 0.0, 0.0),
            mult(rotateY(35), baseModel));

    const modelThreePoint =
        mult(translate(3.0, 0.0, 0.0),
            mult(rotateX(-20), mult(rotateY(35), baseModel)));

    device.queue.writeBuffer(uniformBuffers[0], 0, flatten(mvpFor(modelOnePoint)));
    device.queue.writeBuffer(uniformBuffers[1], 0, flatten(mvpFor(modelTwoPoint)));
    device.queue.writeBuffer(uniformBuffers[2], 0, flatten(mvpFor(modelThreePoint)));

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
        pass.setIndexBuffer(indexBuffer, 'uint32');
        for (let i = 0; i < 3; ++i) {
            pass.setBindGroup(0, bindGroups[i]);
            pass.drawIndexed(wire_indices.length);
        }

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    render();
}

window.addEventListener('load', main);
