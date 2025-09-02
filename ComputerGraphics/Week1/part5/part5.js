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

    function createCircleTriangleStrip(centerX, centerY, radius, segments) {
        const vertices = new Float32Array((segments+1) *4);
        const colors = new Float32Array((segments+1)*6);

        for (let i = 0; i <= segments; i++) {
            vertices[i*4] = centerX;
            vertices[i*4 + 1] = centerY;
            colors[i*6] = 1.0;
            colors[i*6 + 1] = 1.0;
            colors[i*6 + 2] = 1.0;

            const angle = (i / segments) * 2 * Math.PI;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            vertices[i*4 + 2] = x;
            vertices[i*4 + 3] = y;
            colors[i*6 + 3] = 1.0;
            colors[i*6 + 4] = 1.0;
            colors[i*6 + 5] = 1.0;
        }

        return { vertices, colors };
    }

    let result = createCircleTriangleStrip(0,0,0.5,64);
    let vertices = result.vertices;
    let vertexColors = result.colors;


    const vertexBuffer = device.createBuffer({
        label: "vertices",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);

    const vertexColorBuffer = device.createBuffer({
        label: "Colors",
        size: vertexColors.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexColorBuffer, 0, vertexColors);

    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }]
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
            topology: 'triangle-strip',
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

    let startTime = null;
    function render(now) {
        if (!startTime) startTime = now;
        const elapsed = (now - startTime) / 1000;

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
        pass.setVertexBuffer(1, vertexColorBuffer)
        pass.draw(vertices.length / 2);  // call our vertex shader 3 times.
        pass.end();

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
        requestAnimationFrame(render)
    }

    requestAnimationFrame(render)
}

function fail(msg) {
    // eslint-disable-next-line no-alert
    alert(msg);
}

window.addEventListener("load", (event) => {
    main();
});

