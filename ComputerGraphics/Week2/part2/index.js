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
        struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec3f,
      };
      
      @vertex fn vs(
        @location(0) pos: vec2f,
        @location(1) color: vec3f
      ) -> VertexOutput {
        var out: VertexOutput;
        out.position = vec4f(pos, 0.0, 1.0);
        out.color = color;
        return out;
      }

      @fragment fn fs(
        @location(0) color: vec3f
      ) -> @location(0) vec4f {
        return vec4f(color, 1);
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


    let vertices = new Float32Array(0);
    let vertexColors = new Float32Array(0);

    let vertexBuffer = device.createBuffer({
        label: "vertices",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);

    let vertexColorBuffer = device.createBuffer({
        label: "Colors",
        size: vertexColors.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexColorBuffer, 0, vertexColors);




    canvas.addEventListener("click", (event) => {
        const boundingRect = event.target.getBoundingClientRect();
        let mousePosX = event.x - boundingRect.x;
        let mousePosY = event.y - boundingRect.y;
        let xVal = ((mousePosX / canvas.width) - 1/2) * 2;
        let yVal = -((mousePosY / canvas.height) - 1/2) * 2;
        vertices = Float32Array.from([...vertices, xVal, yVal]);
        vertexBuffer = device.createBuffer({
            label: "vertices",
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const color = hexToRgbaArray(pointColorPicker.value).slice(0, 3);
        vertexColors = Float32Array.from([...vertexColors, ...color]);

        console.log(vertexColors)
        vertexColorBuffer = device.createBuffer({
            label: "Colors",
            size: vertexColors.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(vertexBuffer, 0, vertices);
        device.queue.writeBuffer(vertexColorBuffer, 0, vertexColors);
        render();
    })

    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear Canvas';
    document.body.appendChild(clearButton);

    clearButton.addEventListener('click', () => {
        vertices = new Float32Array(0);
        vertexBuffer = device.createBuffer({
            label: "vertices",
            size: 0,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        vertexColors = new Float32Array(0);
        vertexColorBuffer = device.createBuffer({
            label: "Colors",
            size: vertexColors.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        render();
    });

    const canvasColorPicker = document.createElement('input');
    canvasColorPicker.type = 'color';
    canvasColorPicker.value = '#000000';
    document.body.appendChild(canvasColorPicker);

    const pointColorPicker = document.createElement('input');
    pointColorPicker.type = 'color';
    pointColorPicker.value = '#ffffff';
    document.body.appendChild(pointColorPicker);

    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };

    const vertexColorBufferLayout = {
        arrayStride: 12,
        attributes: [{
            format: "float32x3",
            offset: 0,
            shaderLocation: 1, // color
        }]
    };


    const pipeline = device.createRenderPipeline({
        label: 'our hardcoded red triangle pipeline',
        layout: 'auto',
        primitive: {
            topology: 'point-list',
        },
        vertex: {
            module,
            buffers: [vertexBufferLayout, vertexColorBufferLayout]
        },
        fragment: {
            module,
            targets: [{ format: presentationFormat }],
        },
    });

    function hexToRgbaArray(hex, alpha = 1) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b, alpha];
    }



    function render() {
        let renderPassDescriptor = {
            label: 'our basic canvas renderPass',
            colorAttachments: [
                {
                    // view: <- to be filled out when we render
                    clearValue: hexToRgbaArray(canvasColorPicker.value),
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };
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
        pass.setVertexBuffer(1, vertexColorBuffer);
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
