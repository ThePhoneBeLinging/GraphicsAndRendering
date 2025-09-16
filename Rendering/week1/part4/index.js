async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) { fail('need a browser that supports WebGPU'); return; }

    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat });

    //const wgslCode = document.querySelector('script[type="x-shader/x-wgsl"]').textContent;
    const wgslCode = await (await fetch('./index.wgsl')).text();
    const module = device.createShaderModule({ code: wgslCode });

    const vertices = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    vertexBuffer.unmap();

    let aspectRatio = canvas.width / canvas.height;
    let cameraConstant = 1.0;
    const gamma = 2.4;

    const eye = [2,1.5,2];
    const at  = [0,0.5,0];
    const up  = [0,1,0];

    // Pack uniforms (64 bytes)
    const uniformData = new Float32Array([
        // 0..3
        aspectRatio, cameraConstant, 0, 0,        // pad to 16B
        // 4..7
        eye[0], eye[1], eye[2], 0,                // pad after vec3
        // 8..11
        up[0],  up[1],  up[2],  0,
        // 12..15
        at[0],  at[1],  at[2],  0,
        // 16..19
        gamma, 0, 0, 0                             // tail padding
    ]);

    const uniformBuffer = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 8,
                attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }]
            }]
        },
        fragment: {
            module,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    const renderPassDescriptor = {
        colorAttachments: [{ clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store' }],
    };

    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    function render() {
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setPipeline(pipeline);
        pass.draw(4);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        render();
    }

    addEventListener("wheel", (event) => {
        cameraConstant *= 1.0 + 2.5e-4*event.deltaY;
        uniformData[1] = cameraConstant; // update in-place
        requestAnimationFrame(animate);
    });

    animate();
}

function fail(msg) { alert(msg); }
window.addEventListener("load", main);
