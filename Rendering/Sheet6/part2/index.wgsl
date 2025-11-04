struct Uniforms {
    aspectRatio: f32,
    cameraConstant: f32,
    repeat: f32,
    filterMode: f32,
    eye: vec3f,
    useTexture: f32,
    up: vec3f,
    scaleFactor: f32,
    at: vec3f,
    jitterVectorCount: f32,
    gamma: f32,
    _pad5: vec3f,
};

struct Aabb {
    min: vec3f,
    max: vec3f,
};

struct Ray {
    origin: vec3f,
    direction: vec3f,
    tmin: f32,
    tmax: f32,
};

struct HitInfo {
    has_hit: bool,
    dist: f32,
    position: vec3f,
    normal: vec3f,
};

struct JitterBuffer {
    data: array<vec2f>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var my_texture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> jitters: JitterBuffer;
@group(0) @binding(3) var<storage, read> vPositions: array<vec4f>;
@group(0) @binding(4) var<storage, read> meshFaces: array<vec3u>;
@group(0) @binding(5) var<storage, read> meshNormals: array<vec4f>;

@group(0) @binding(6) var<storage, read> treeIds: array<u32>;
@group(0) @binding(7) var<storage, read> bspTree: array<vec4u>;
@group(0) @binding(8) var<storage, read> bspPlanes: array<f32>;
@group(0) @binding(9) var<uniform> aabb: Aabb;

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) imagePlanePos : vec2<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.imagePlanePos = pos;
    return out;
}

fn orthonormal_camera_basis() -> mat3x3<f32> {
    let w = normalize(uniforms.eye - uniforms.at);
    let u = normalize(cross(uniforms.up, w));
    let v = cross(w, u);
    return mat3x3<f32>(u, v, w);
}

fn intersect_aabb_clip(r: ptr<function, Ray>) -> bool {
    let p1 = (aabb.min - (*r).origin) / (*r).direction;
    let p2 = (aabb.max - (*r).origin) / (*r).direction;
    let pmin = min(p1, p2);
    let pmax = max(p1, p2);
    var t0 = max(pmin.x, max(pmin.y, pmin.z)) - 1.0e-4;
    var t1 = min(pmax.x, min(pmax.y, pmax.z)) + 1.0e-4;

    if (t0 > t1 || t0 > (*r).tmax || t1 < (*r).tmin) {
        return false;
    }
    (*r).tmin = max(t0, (*r).tmin);
    (*r).tmax = min(t1, (*r).tmax);
    return true;
}

fn intersect_triangle(r: ptr<function, Ray>, hit: ptr<function, HitInfo>, triIndex: u32) -> bool {
    let face = meshFaces[triIndex];
    let p0 = vPositions[face.x].xyz;
    let p1 = vPositions[face.y].xyz;
    let p2 = vPositions[face.z].xyz;

    let e0 = p1 - p0;
    let e1 = p2 - p0;
    let n = cross(e0, e1);

    let denom = dot((*r).direction, n);
    let eps = 1e-8;
    if (abs(denom) < eps) { return false; }

    let t = dot(p0 - (*r).origin, n) / denom;
    if (!((*r).tmin < t && t < (*r).tmax)) { return false; }

    let a = p0 - (*r).origin;
    let c1 = cross(a, (*r).direction);
    let beta = dot(c1, e1) / denom;
    let gamma = -dot(c1, e0) / denom;

    if (beta >= 0.0 && gamma >= 0.0 && (beta + gamma) <= 1.0) {
        let w0 = 1.0 - beta - gamma;
        let n0 = meshNormals[face.x].xyz;
        let n1 = meshNormals[face.y].xyz;
        let n2 = meshNormals[face.z].xyz;
        let interpN = normalize(n0 * w0 + n1 * beta + n2 * gamma);

        (*hit).has_hit = true;
        (*hit).dist = t;
        (*hit).position = (*r).origin + (*r).direction * t;
        (*hit).normal = interpN;
        return true;
    }
    return false;
}


const MAX_LEVEL: u32 = 20u;
const BSP_LEAF: u32 = 3u;

var<private> branch_node: array<vec2u, MAX_LEVEL>;
var<private> branch_ray : array<vec2f, MAX_LEVEL>;

fn intersect_trimesh(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> bool {
    var branch_lvl = 0u;
    var node = 0u;

    for (var i = 0u; i <= MAX_LEVEL; i = i + 1u) {
        let tree_node = bspTree[node];
        let axis_or_leaf = tree_node.x & 3u;

        if (axis_or_leaf == BSP_LEAF) {
            let count = tree_node.x >> 2u;
            let offset = tree_node.y;

            var found_any = false;
            for (var j = 0u; j < count; j = j + 1u) {
                let tri_idx = treeIds[offset + j];
                if (intersect_triangle(r, hit, tri_idx)) {
                    (*r).tmax = (*hit).dist;
                    found_any = true;
                }
            }
            if (found_any) { return true; }

            if (branch_lvl == 0u) { return false; }
            branch_lvl = branch_lvl - 1u;
            i = branch_node[branch_lvl].x;
            node = branch_node[branch_lvl].y;
            (*r).tmin = branch_ray[branch_lvl].x;
            (*r).tmax = branch_ray[branch_lvl].y;
            continue;
        }

        let axis = axis_or_leaf;
        let plane = bspPlanes[node];

        let dir_a = (*r).direction[axis];
        let org_a = (*r).origin[axis];
        let left_id = tree_node.z;
        let right_id = tree_node.w;

        var near_node = left_id;
        var far_node = right_id;
        if (dir_a < 0.0) {
            near_node = right_id;
            far_node = left_id;
        }

        let denom = select(dir_a, 1.0e-8, abs(dir_a) < 1.0e-8);
        let t = (plane - org_a) / denom;

        if (t > (*r).tmax) {
            node = near_node;
        } else if (t < (*r).tmin) {
            node = far_node;
        } else {
            branch_node[branch_lvl].x = i;
            branch_node[branch_lvl].y = far_node;
            branch_ray[branch_lvl].x = t;
            branch_ray[branch_lvl].y = (*r).tmax;
            branch_lvl = branch_lvl + 1u;

            (*r).tmax = t;
            node = near_node;
        }
    }
    return false;
}

fn intersect_scene(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> bool {
    if (!intersect_aabb_clip(r)) { return false; }
    return intersect_trimesh(r, hit);
}

fn shade_lambert(n: vec3f) -> vec3f {
    let L = normalize(vec3f(-0.6, 0.7, -0.4));
    let N = normalize(n);
    let ndotl = max(dot(N, L), 0.0);
    let ambient = 0.08;
    let albedo  = vec3f(0.82, 0.82, 0.82);
    return albedo * (ambient + ndotl);
}

struct FragOut {
    @location(0) color: vec4f
};

@fragment
fn fs_main(input: VertexOutput) -> FragOut {
    let p = input.imagePlanePos;
    let cam = orthonormal_camera_basis();
    let u = cam[0];
    let v = cam[1];
    let w = cam[2];

    let origin = uniforms.eye;

    var accum = vec3f(0.0);
    let JV = u32(uniforms.jitterVectorCount);
    let aspect = uniforms.aspectRatio;

    for (var i = 0u; i < JV; i = i + 1u) {
        let j = jitters.data[i];
        let dir = normalize(-uniforms.cameraConstant * w
                            + (p.x + j.x) * aspect * u
                            + (p.y + j.y) * v);

        var ray = Ray(origin, dir, 0.0, 1.0e5);
        var hit = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0));
        var color = vec3f(0.1, 0.3, 0.6);
        if (intersect_scene(&ray, &hit)) {
            color = shade_lambert(hit.normal);
        }
        accum += color;
    }

    let avg = accum / max(1.0, f32(JV));
    let gamma = max(uniforms.gamma, 1.0);
    let mapped = pow(avg, vec3f(1.0 / gamma));
    return FragOut(vec4f(mapped, 1.0));
}
