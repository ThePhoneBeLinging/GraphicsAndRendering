async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
        fail('need a browser that supports WebGPU');
        return;
    }

    // Get a WebGPU context from the canvas and configure it
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: presentationFormat,
    });
    const wgslCode = document.querySelector('script[type="x-shader/x-wgsl"]').textContent;

    const module = device.createShaderModule({
        label: 'our hardcoded red triangle shaders',
        code: wgslCode,
    });

    const vertices = new Float32Array([
        -1, -1,
        1, -1,
        -1,  1,
        1,  1
    ]);

    const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    vertexBuffer.unmap();

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: module,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 8,
                attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }]
            }]
        },
        fragment: {
            module: module,
            entryPoint: 'fs_main',
            targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    const renderPassDescriptor = {
        label: 'our basic canvas renderPass',
        colorAttachments: [
            {
                // view: <- to be filled out when we render
                clearValue: [0, 0, 0, 0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    };

    function render() {
        // Get the current texture from the canvas context and
        // set it as the texture to render to.
        renderPassDescriptor.colorAttachments[0].view =
            context.getCurrentTexture().createView();

        // make a command encoder to start encoding commands
        const encoder = device.createCommandEncoder({ label: 'our encoder' });

        // make a render pass encoder to encode render specific commands
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
    }

    render();
}

function fail(msg) {
    // eslint-disable-next-line no-alert
    alert(msg);
}

window.addEventListener("load", (event) => {
    main();
});

