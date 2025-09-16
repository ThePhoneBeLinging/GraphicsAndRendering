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

    let aspectRatio = canvas.width / canvas.height;
    let cameraConstant = 1;

    // Eye position
    const eye = vec3(2, 1.5, 2.0); // Example eye position
    const at = vec3(0, 0.5, 0);  // Look-at point
    const up = vec3(0, 1, 0);  // Up vector

    // Compute basis vectors
    const w = normalize(subtract(eye, at)); // Camera backward
    const u = normalize(cross(up, w));      // Camera right
    const v = cross(w, u);                     // Camera up

    // Flatten for uniform upload
    const eyeArr = [eye[0], eye[1], eye[2], 0];
    const uArr = [u[0], u[1], u[2], 0];
    const vArr = [v[0], v[1], v[2], 0];


    // --- Uniform buffer: aspectRatio, cameraConstant, eye, u, v ---
    const uniformData = new Float32Array([
        aspectRatio, cameraConstant,
        ...eyeArr,
        ...uArr,
        ...vArr
    ]);

    /*addEventListener("wheel", (event) => {
        cameraConstant *= 1.0 + 2.5e-4*event.deltaY;
        new Float32Array(uniformData, 4, 1).set([cameraConstant]);
        requestAnimationFrame(animate);
    });*/
    let yDiff = 0;
    /*addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") {
            console.log("up");
            yDiff += 0.1;
        }
        if (event.key === "ArrowDown") {
            yDiff -= 0.1;
        }
        cameraConstant *= 1.0 + yDiff;
        new Float32Array(uniformData, 4, 1).set([cameraConstant]);
        requestAnimationFrame(animate);
    });*/

    function animate()
    {
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render(device, context, pipeline, bindGroup);
    }

    const uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);



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

    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    // Create a bind group
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: uniformBuffer },
            },
        ],
    });

    function render() {
        // Get the current texture from the canvas context and
        // set it as the texture to render to.
        renderPassDescriptor.colorAttachments[0].view =
            context.getCurrentTexture().createView();

        // make a command encoder to start encoding commands
        const encoder = device.createCommandEncoder({ label: 'our encoder' });

        // make a render pass encoder to encode render specific commands
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
    }

    animate();
}

function fail(msg) {
    // eslint-disable-next-line no-alert
    alert(msg);
}

window.addEventListener("load", (event) => {
    main();
});
