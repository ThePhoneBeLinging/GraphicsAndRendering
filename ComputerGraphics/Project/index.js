async function main() {
    const canvas = document.getElementById('gfx');
    const matcapSelect = document.getElementById('matcapSelect');
    const mixSlider = document.getElementById('mixSlider');
    const mixValue = document.getElementById('mixValue');
    const tintColorInput = document.getElementById('tintColor');
    const orbitToggle = document.getElementById('orbitToggle');

    let orbiting = true;
    let totalPausedTime = 0;
    let pauseStart = 0;
    let lastAngles = { angleY: 0, angleX: 0, angleZ: 0 };
    let lastCam = { camX: 0, camY: 0, camZ: 0 };

    if (!navigator.gpu) {
        alert('WebGPU not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: 'opaque'
    });

    let depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const sphere = createSphere(1.0, 64, 32);
    const vertexBuffer = device.createBuffer({
        size: sphere.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, sphere.vertices);

    const indexBuffer = device.createBuffer({
        size: sphere.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, sphere.indices);

    const indexCount = sphere.indices.length;

    const uniformBufferSize = 4 * 16 * 2;
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const paramsBufferSize = 32;
    const paramsBuffer = device.createBuffer({
        size: paramsBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const paramsData = new Float32Array(8);
    paramsData[0] = 1.0;
    paramsData[1] = 1.0;
    paramsData[2] = 1.0;
    paramsData[3] = parseFloat(mixSlider.value);
    paramsData[4] = 1.0;
    paramsData[5] = 1.0;
    paramsData[6] = 1.0;
    paramsData[7] = 0.0;

    device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const shaderModule = device.createShaderModule({
        code: await (await fetch('index.wgsl')).text(),
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'filtering' },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [
                {
                    arrayStride: 6 * 4,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3',
                        },
                        {
                            shaderLocation: 1,
                            offset: 3 * 4,
                            format: 'float32x3',
                        },
                    ],
                },
            ],
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [
                {
                    format,
                },
            ],
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'back',
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    let matcapTexture = await loadTexture(device, matcapSelect.value);
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    let bindGroup = createBindGroup();

    function createBindGroup() {
        return device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer },
                },
                {
                    binding: 1,
                    resource: matcapTexture.createView(),
                },
                {
                    binding: 2,
                    resource: sampler,
                },
                {
                    binding: 3,
                    resource: { buffer: paramsBuffer },
                },
            ],
        });
    }

    matcapSelect.addEventListener('change', async () => {
        matcapTexture = await loadTexture(device, matcapSelect.value);
        bindGroup = createBindGroup();
    });

    mixSlider.addEventListener('input', () => {
        const v = parseFloat(mixSlider.value);
        mixValue.textContent = v.toFixed(2);
        paramsData[3] = v;
        device.queue.writeBuffer(paramsBuffer, 0, paramsData);
    });

    tintColorInput.addEventListener('input', () => {
        const rgb = hexToRgb(tintColorInput.value);
        paramsData[4] = rgb[0];
        paramsData[5] = rgb[1];
        paramsData[6] = rgb[2];
        device.queue.writeBuffer(paramsBuffer, 0, paramsData);
    });

    orbitToggle.addEventListener('click', () => {
        orbiting = !orbiting;
        orbitToggle.textContent = orbiting ? 'Stop Orbit' : 'Resume Orbit';
        if (!orbiting) {
            pauseStart = performance.now();
        } else {
            totalPausedTime += performance.now() - pauseStart;
        }
    });

    let previousTime = 0;

    function frame(time) {
        const dt = (time - previousTime) * 0.001;
        previousTime = time;

        const aspect = canvas.width / canvas.height;
        const fov= (60 * Math.PI) / 180;
        const near= 0.1;
        const far= 100.0;

        const proj = mat4_perspective(fov, aspect, near, far);

        let t = (time - totalPausedTime) * 0.001;

        const radius = 4.0;
        let camX, camY, camZ;
        if (orbiting) {
            camX = Math.cos(t * 0.4) * radius;
            camZ = Math.sin(t * 0.4) * radius;
            camY = 0.7 + 0.3 * Math.sin(t * 0.7);
            lastCam = { camX, camY, camZ };
        } else {
            ({ camX, camY, camZ } = lastCam);
        }

        const view = mat4_lookAt(
            [camX, camY, camZ],
            [0, 0, 0],
            [0, 1, 0]
        );

        let angleY, angleX, angleZ;
        if (orbiting) {
            angleY = t * 0.9;
            angleX = t * 0.6;
            angleZ = t * 0.3;
            lastAngles = { angleY, angleX, angleZ };
        } else {
            ({ angleY, angleX, angleZ } = lastAngles);
        }

        const rotY= mat4_rotationY(angleY);
        const rotX= mat4_rotationX(angleX);
        const rotZ= mat4_rotationZ(angleZ);

        const modelXY= mat4_multiply(rotY, rotX);
        const model= mat4_multiply(modelXY, rotZ);

        const modelView= mat4_multiply(view, model);
        const uniformsData= new Float32Array(32);
        uniformsData.set(modelView, 0);
        uniformsData.set(proj, 16);

        device.queue.writeBuffer(uniformBuffer, 0, uniformsData);

        const colorAttachment = {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.05, g: 0.05, b: 0.06, a: 1.0 },
        };

        const depthAttachment = {
            view: depthTexture.createView(),
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
        };

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [colorAttachment],
            depthStencilAttachment: depthAttachment,
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setIndexBuffer(indexBuffer, 'uint32');
        passEncoder.drawIndexed(indexCount, 1, 0, 0, 0);
        passEncoder.end();

        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

function createSphere(radius, segments, rings) {
    const vertices= [];
    const indices= [];

    for (let y= 0; y <= rings; ++y) {
        const v= y / rings;
        const theta= v * Math.PI;

        for (let x= 0; x <= segments; ++x) {
            const u= x / segments;
            const phi= u * 2.0 * Math.PI;

            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const nx = sinTheta * cosPhi;
            const ny = cosTheta;
            const nz = sinTheta * sinPhi;

            const px = radius * nx;
            const py = radius * ny;
            const pz = radius * nz;

            vertices.push(px, py, pz, nx, ny, nz);
        }
    }

    const cols = segments + 1;
    for (let y = 0; y < rings; ++y) {
        for (let x = 0; x < segments; ++x) {
            const i0 = y * cols + x;
            const i1 = i0 + 1;
            const i2 = i0 + cols;
            const i3 = i2 + 1;

            indices.push(i0, i2, i1);
            indices.push(i1, i2, i3);
        }
    }

    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
    };
}

async function loadTexture(device, url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        { width: imageBitmap.width, height: imageBitmap.height }
    );

    return texture;
}

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    return [r, g, b];
}

function mat4_identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
}

function mat4_multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; ++i) {
        const ai0 = a[i];
        const ai1 = a[i + 4];
        const ai2 = a[i + 8];
        const ai3 = a[i + 12];
        out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
        out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
        out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
        out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
    }
    return out;
}

function mat4_perspective(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);

    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = (2 * far * near) * nf;
    return out;
}

function mat4_lookAt(eye, center, up) {
    const [ex, ey, ez] = eye;
    const [cx, cy, cz] = center;
    const [ux, uy, uz] = up;

    let zx = ex - cx;
    let zy = ey - cy;
    let zz = ez - cz;
    let len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;

    let xx = uy * zz - uz * zy;
    let xy = uz * zx - ux * zz;
    let xz = ux * zy - uy * zx;
    len = Math.hypot(xx, xy, xz);
    xx /= len; xy /= len; xz /= len;

    let yx = zy * xz - zz * xy;
    let yy = zz * xx - zx * xz;
    let yz = zx * xy - zy * xx;

    const out = new Float32Array(16);
    out[0] = xx; out[4] = yx; out[8]  = zx; out[12] = ex;
    out[1] = xy; out[5] = yy; out[9]  = zy; out[13] = ey;
    out[2] = xz; out[6] = yz; out[10] = zz; out[14] = ez;
    out[3] = 0;  out[7] = 0;  out[11] = 0;  out[15] = 1;

    out[12] = -(xx * ex + yx * ey + zx * ez);
    out[13] = -(xy * ex + yy * ey + zy * ez);
    out[14] = -(xz * ex + yz * ey + zz * ez);

    return out;
}

function mat4_rotationY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4_identity();
    out[0] =  c;
    out[2] =  s;
    out[8] = -s;
    out[10] = c;
    return out;
}

function mat4_rotationX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4_identity();
    out[5] = c;
    out[6] = s;
    out[9] = -s;
    out[10] = c;
    return out;
}

function mat4_rotationZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4_identity();
    out[0] = c;
    out[1] = s;
    out[4] = -s;
    out[5] = c;
    return out;
}

window.addEventListener('load', main);



