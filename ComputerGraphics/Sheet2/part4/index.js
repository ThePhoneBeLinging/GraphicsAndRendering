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

    function createCircleVertices(centerX, centerY, radius, segments) {
        const vertices = [];
        // Center vertex
        vertices.push(centerX, centerY);
        for (let i = 0; i <= segments; ++i) {
            const angle = (i / segments) * 2 * Math.PI;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            vertices.push(x, y);
        }
        // Create triangles
        const triangleVertices = [];
        for (let i = 1; i <= segments; ++i) {
            triangleVertices.push(
                centerX, centerY,
                vertices[i * 2], vertices[i * 2 + 1],
                vertices[(i + 1) * 2], vertices[(i + 1) * 2 + 1]
            );
        }
        return new Float32Array(triangleVertices);
    }

    let pointArray = new Float32Array(6);
    let circleArray = new Float32Array(4);
    let index = 0;
    let circleIndex = 0;

    canvas.addEventListener("click", (event) => {
        const boundingRect = event.target.getBoundingClientRect();
        let mousePosX = event.x - boundingRect.x;
        let mousePosY = event.y - boundingRect.y;
        let xVal = ((mousePosX / canvas.width) - 1/2) * 2;
        let yVal = -((mousePosY / canvas.height) - 1/2) * 2;
        let square = createSquare(xVal, yVal, sizeOfPixelX, sizeOfPixelY);

        vertices = Float32Array.from([...vertices, ...square]);


        const color = hexToRgbaArray(pointColorPicker.value).slice(0, 3);
        vertexColors = Float32Array.from([...vertexColors, ...color, ...color, ...color, ...color, ...color, ...color]);

        if (triangleMode) {
            pointArray[index++] = xVal;
            pointArray[index++] = yVal;
        }

        if (triangleMode && index === 6) {
            index = 0;
            vertices = vertices.slice(0, vertices.length - 36);
            vertices = Float32Array.from([...vertices, ...pointArray]);
            vertexColors = vertexColors.slice(0, vertexColors.length - 45);
            pointArray = new Float32Array(6);
        }

        if (circleMode) {
            circleArray[circleIndex++] = xVal;
            circleArray[circleIndex++] = yVal;
        }

        if (circleMode && circleIndex === 4) {
            circleIndex = 0;
            vertices = vertices.slice(0, vertices.length - 24);
            vertexColors = vertexColors.slice(0, vertexColors.length - 30);

            const radius = Math.sqrt(Math.pow(circleArray[0] - circleArray[2],2) + Math.pow(circleArray[1] - circleArray[3],2));
            const segments = 64;
            const circleVertices = createCircleVertices(circleArray[0], circleArray[1], radius, segments);
            vertices = Float32Array.from([...vertices, ...circleVertices]);
            for (let i = 0; i < segments*3 - 2; i++) {
               vertexColors = Float32Array.from([...vertexColors, ...hexToRgbaArray(pointColorPicker.value).slice(0, 3)]);
            }
            console.log(vertices.length / 2);
            console.log(vertexColors.length / 3);
            circleArray = new Float32Array(4);
        }

        vertexBuffer = device.createBuffer({
            label: "vertices",
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        vertexColorBuffer = device.createBuffer({
            label: "Colors",
            size: vertexColors.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(vertexBuffer, 0, vertices);
        device.queue.writeBuffer(vertexColorBuffer, 0, vertexColors);
        render();
    })

    let triangleMode = false;
    const triangleModeButton = document.createElement('button');
    triangleModeButton.textContent = triangleMode ? 'Triangle Mode: On' : 'Triangle Mode: Off';
    document.body.appendChild(triangleModeButton);
    triangleModeButton.addEventListener('click', () => {
        if (circleMode)
        {
            toggleCircleMode();
        }
        toggleTriangleMode();
    });

    let circleMode = false;
    const circleModeButton = document.createElement('button');
    circleModeButton.textContent = circleMode ? 'Circle Mode: On' : 'Circle Mode: Off';
    document.body.appendChild(circleModeButton);
    circleModeButton.addEventListener('click', () => {
        if (triangleMode)
        {
            toggleTriangleMode();
        }
        toggleCircleMode();
    });

    function toggleTriangleMode()
    {
        triangleMode = !triangleMode;
        triangleModeButton.textContent = triangleMode ? 'Triangle Mode: On' : 'Triangle Mode: Off';
    }

    function toggleCircleMode() {
        circleMode = !circleMode;
        circleModeButton.textContent = circleMode ? 'Circle Mode: On' : 'Circle Mode: Off';
    }

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
            topology: 'triangle-list',
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
