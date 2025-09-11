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

    const module = device.createShaderModule({
        label: 'our hardcoded red triangle shaders',
        code: `
      @vertex fn vs(
        @location(0) pos: vec2f
      ) -> @builtin(position) vec4f {
        return vec4f(pos, 0.0, 1.0);
      }

      @fragment fn fs() -> @location(0) vec4f {
        return vec4f(0, 0, 0, 1);
      }
    `,
    });

    function createSquare(centerX, centerY, sizeX, sizeY) {
        const halfSizeX = sizeX / 2;
        const halfSizeY = sizeY / 2;
        return [
            centerX - halfSizeX, centerY + halfSizeY,
            centerX + halfSizeX, centerY + halfSizeY,
            centerX - halfSizeX, centerY - halfSizeY,

            centerX - halfSizeX, centerY - halfSizeY,
            centerX + halfSizeX, centerY + halfSizeY,
            centerX + halfSizeX, centerY - halfSizeY,
        ];
    }

    let sizeOfPixelX = (2 / canvas.width) * 20;
    let sizeOfPixelY = (2 / canvas.height) * 20;
    let firstSquareVertices = createSquare(0.0,0.0,sizeOfPixelX,sizeOfPixelY);
    let secondSquareVertices = createSquare(1,0,sizeOfPixelX,sizeOfPixelY);
    let thirdSquareVertices = createSquare(1,1,sizeOfPixelX,sizeOfPixelY);


    let vertices = new Float32Array(firstSquareVertices.length + secondSquareVertices.length + thirdSquareVertices.length);
    vertices.set(firstSquareVertices);
    vertices.set(secondSquareVertices, firstSquareVertices.length);
    vertices.set(thirdSquareVertices, firstSquareVertices.length + secondSquareVertices.length);

    let vertexBuffer = device.createBuffer({
        label: "vertices",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);

    canvas.addEventListener("click", (event) => {
        const boundingRect = event.target.getBoundingClientRect();
        let mousePosX = event.x - boundingRect.x;
        let mousePosY = event.y - boundingRect.y;
        let xVal = ((mousePosX / canvas.width) - 1/2) * 2;
        let yVal = -((mousePosY / canvas.height) - 1/2) * 2;
        let square = createSquare(xVal, yVal, 0.1, 0.1);
        vertices = Float32Array.from([...vertices, ...square]);
        vertexBuffer = device.createBuffer({
            label: "vertices",
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(vertexBuffer, 0, vertices);
        render();
    })



    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };


    const pipeline = device.createRenderPipeline({
        label: 'our hardcoded red triangle pipeline',
        layout: 'auto',
        vertex: {
            module,
            buffers: [vertexBufferLayout]
        },
        fragment: {
            module,
            targets: [{ format: presentationFormat }],
        },
    });

    const renderPassDescriptor = {
        label: 'our basic canvas renderPass',
        colorAttachments: [
            {
                // view: <- to be filled out when we render
                clearValue: [0.3921, 0.5843, 0.9294, 1],
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
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vertices.length / 2);  // call our vertex shader 3 times.
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

