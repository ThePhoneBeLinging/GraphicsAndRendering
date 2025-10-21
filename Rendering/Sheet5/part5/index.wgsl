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

struct Ray {
    origin: vec3f,
    direction: vec3f,
    tmin: f32,
    tmax: f32,
};

struct Color {
    ambient: vec3f,
    diffuse: vec3f,
    specular: vec3f,
};

struct HitInfo {
    has_hit: bool,
    dist: f32,
    position: vec3f,
    normal: vec3f,
    color: Color,
    shader: u32,
    indexOfRefraction: f32,
    shininess: f32
};

struct Light {
    L_i: vec3f,
    w_i: vec3f,
    dist: f32,
    rayFromPoint: vec3f
};

struct Onb {
    tangent: vec3f,
    binormal: vec3f,
    normal: vec3f,
};

struct JitterBuffer {
    data: array<vec2f>,
};

struct Material {
    emission: vec3f,
    diffuse: vec3f,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var my_texture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> jitters: JitterBuffer;
@group(0) @binding(3) var<storage, read> vPositions: array<vec3f>;
@group(0) @binding(4) var<storage, read> meshFaces: array<vec3u>;
@group(0) @binding(5) var<storage, read> vNormals: array<vec3f>;
@group(0) @binding(6) var<storage, read> materials: array<Material>;
@group(0) @binding(7) var<storage, read> matIndices: array<u32>;
@group(0) @binding(8) var<storage, read> lightIndices: array<u32>;

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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let p = input.imagePlanePos; // in [-1,1]

    // Camera basis (right-handed)
    let w = normalize(uniforms.eye - uniforms.at);     // camera backward
    let u = normalize(cross(uniforms.up, w));          // camera right
    let v = cross(w, u);                               // camera up

    // Ray through the image plane located at distance 'cameraConstant'
    let origin = uniforms.eye;

    var resultPostJitter = vec3f(0.0);
    let jitterVectorCount = u32(uniforms.jitterVectorCount);
    for (var i = 0u; i < jitterVectorCount; i+=1) {
        let jitter = jitters.data[i];
        let direction = normalize(-uniforms.cameraConstant * w
            + (p.x + jitter.x) * uniforms.aspectRatio * u
            + (p.y + jitter.y) * v);
        var ray = Ray(origin, direction, 0, 1e5);
        const maxDepth = 10;
        const background_color =  vec3f(0.1, 0.3, 0.6);
        let color = Color(vec3f(0.0), vec3f(0.0), vec3f(0.0));
        var hitInfo = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), color, 0u, 1.5, 0.0);
        var result = vec3f(0.0);
        for (var i = 0; i < maxDepth; i++) {
            if (intersect_scene(&ray, &hitInfo)) {
                result += shade(&ray, &hitInfo);
            } else {
                result += background_color;
                break;
            }
            if (hitInfo.has_hit)
            {
                break;
            }
        }
        resultPostJitter += result;
    }
    resultPostJitter /= uniforms.jitterVectorCount;

    return vec4f(pow(resultPostJitter,vec3f(1.0/uniforms.gamma)), 1.0);
}

fn texture_nearest(texture: texture_2d<f32>, texcoords: vec2f, repeat: bool) -> vec3f {
    let res = textureDimensions(texture);
    var coords = texcoords;
    if (repeat) {
        coords = fract(coords);
    }
    let texelCoords = vec2i(i32(coords.x * f32(res.x)), i32(coords.y * f32(res.y)));
    let texcolor = textureLoad(texture, texelCoords, 0);
    return texcolor.rgb;
}

fn texture_linear(tex: texture_2d<f32>, clip: vec2f, repeat: bool) -> vec3f {
    let res_u = textureDimensions(tex);
    let res_f = vec2f(res_u);
    let res_i = vec2i(res_u);

    var uv = clip * 0.5 + 0.5;

    if (repeat) {
        uv = fract(uv);
    } else {
        uv = clamp(uv, vec2f(0.0), vec2f(1.0));
    }

    let ab = uv * res_f;

    var U  = i32(floor(ab.x));
    var V  = i32(floor(ab.y));

    let cx = ab.x - f32(U);
    let cy = ab.y - f32(V);

    var U1 = U + 1;
    var V1 = V + 1;

    if (repeat) {
        let w = res_i.x;
        let h = res_i.y;
        U  = ((U  % w) + w) % w;
        U1 = ((U1 % w) + w) % w;
        V  = ((V  % h) + h) % h;
        V1 = ((V1 % h) + h) % h;
    } else {
        let maxx = res_i.x - 1;
        let maxy = res_i.y - 1;
        U  = clamp(U,  0, maxx);
        U1 = clamp(U1, 0, maxx);
        V  = clamp(V,  0, maxy);
        V1 = clamp(V1, 0, maxy);
    }

    let c00 = textureLoad(tex, vec2i(U,  V ), 0).rgb;
    let c10 = textureLoad(tex, vec2i(U1, V ), 0).rgb;
    let c01 = textureLoad(tex, vec2i(U,  V1), 0).rgb;
    let c11 = textureLoad(tex, vec2i(U1, V1), 0).rgb;

    let cx0 = mix(c00, c10, cx);
    let cx1 = mix(c01, c11, cx);
    return mix(cx0, cx1, cy);
}

fn intersect_scene(ray: ptr<function, Ray>, hitInfo: ptr<function, HitInfo>) -> bool {
    var closest_t = (*ray).tmax;
    var found = false;
    let color = Color(vec3f(0.0), vec3f(0.0), vec3f(0.0));
    var best = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), color, 0u, 0.0, 0.0);

    let num_faces = arrayLength(&meshFaces);
    for (var face_idx = 0u; face_idx < num_faces; face_idx += 1u) {
        let th = intersect_triangle(*ray, face_idx);
        if (th.has_hit && th.dist < closest_t && th.dist > (*ray).tmin) {
            best = th;
            closest_t = th.dist;
            found = true;
        }
    }

    if (found) {
        *hitInfo = best;
        (*ray).tmax = closest_t;
    }
    return found;
}


fn sample_area_light(p: vec3f) -> Light {
    const PI = 3.14159265359;
    
    // Get number of light sources
    let num_lights = arrayLength(&lightIndices);
    if (num_lights == 0u) {
        // Fallback to directional light if no area lights
        let light_direction = normalize(vec3f(-1.0));
        let wi = -light_direction;
        let Le = vec3f(PI, PI, PI);
        let dist = 1e5;
        let rayFromPoint = -light_direction * dist;
        return Light(Le, wi, dist, rayFromPoint);
    }
    
    var total_radiance = vec3f(0.0);
    var total_wi = vec3f(0.0);
    var closest_distance = 1e5;
    var best_light_vector = vec3f(0.0);
    
    // Sample all light sources and accumulate their contributions
    for (var light_idx = 0u; light_idx < num_lights; light_idx += 1u) {
        let light_face_idx = lightIndices[light_idx];
        let face = meshFaces[light_face_idx];
        
        let v0 = vPositions[face.x];
        let v1 = vPositions[face.y];
        let v2 = vPositions[face.z];
        
        // Sample center of triangle (can be extended for Monte Carlo sampling)
        let light_position = (v0 + v1 + v2) / 3.0;
        
        // Calculate triangle area and normal
        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let triangle_normal = normalize(cross(edge1, edge2));
        let area = 0.5 * length(cross(edge1, edge2));
        
        // Vector from hit point to light
        let light_vector = light_position - p;
        let distance = length(light_vector);
        let wi = normalize(light_vector);
        
        // Get emission from material
        let material_index = matIndices[light_face_idx];
        let material = materials[material_index];
        let emission = material.emission.xyz;
        
        // Skip if no emission
        if (length(emission) < 0.001) {
            continue;
        }
        
        // Calculate angle between light normal and direction to hit point
        let cos_light = max(dot(-wi, triangle_normal), 0.0);
        
        // Only consider lights facing the hit point
        if (cos_light > 0.0) {
            // Calculate radiance using area light equation:
            // L = Le * cos(θ_light) * area / distance²
            let radiance = emission * cos_light * area / (distance * distance);
            total_radiance += radiance;
            total_wi += wi * length(radiance);
            
            if (distance < closest_distance) {
                closest_distance = distance;
                best_light_vector = light_vector;
            }
        }
    }
    
    // Normalize the accumulated direction
    if (length(total_wi) > 0.0) {
        total_wi = normalize(total_wi);
    } else {
        // Fallback if no valid lights
        total_wi = vec3f(0.0, 1.0, 0.0);
        total_radiance = vec3f(0.1);
    }
    
    return Light(total_radiance, total_wi, closest_distance, best_light_vector);
}

fn sample_directional_light(p: vec3f) -> Light {
    const PI = 3.14159265359;
    
    let light_direction = normalize(vec3f(-1.0));
    let wi = -light_direction;
    let Le = vec3f(PI, PI, PI);
    
    let dist = 1e5;
    
    let rayFromPoint = -light_direction * dist;
    
    return Light(Le, wi, dist, rayFromPoint);
}

fn shade(ray: ptr<function, Ray>, hitInfo: ptr<function, HitInfo>) -> vec3f {
    const PI = 3.14159265359;
    let light = sample_area_light((*hitInfo).position);

    var shadowRay = Ray(hitInfo.position + 1e-4 * hitInfo.normal, normalize(light.rayFromPoint), 0, light.dist - 1e-3);
    var shadowHitInfo = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), 0,0,0);
    var inShadow = intersect_scene(&shadowRay, &shadowHitInfo);


    switch (hitInfo.shader)
    {
        case 0u: { // Plane

            break;
        }
        case 1u: { // Sphere

            let normalizedNormal = normalize((*hitInfo).normal);
            let normailzedDirection = normalize(ray.direction);
            if (dot(normalizedNormal, normailzedDirection) < 0.0) {
                (*hitInfo).indexOfRefraction = 1.0 / (*hitInfo).indexOfRefraction;
            } else {
                (*hitInfo).indexOfRefraction =  (*hitInfo).indexOfRefraction / 1.0;
                (*hitInfo).normal = -(*hitInfo).normal;
            }

            let refractedRayDirection = refract(ray.direction, (*hitInfo).normal, (*hitInfo).indexOfRefraction);
            *ray = Ray((*hitInfo).position - 1e-4 * (*hitInfo).normal, refractedRayDirection, 0, 1e5);
            (*hitInfo).has_hit = false;
            return vec3f(0.0);
        }
        case 2u: { // Triangle
            break;
        }
        case 3u: { // Mirror
            let reflectedRayDirection = reflect(ray.direction, (*hitInfo).normal);
            (*hitInfo).has_hit = false;
            *ray = Ray((*hitInfo).position + 1e-4 * (*hitInfo).normal, reflectedRayDirection, 0, 1e5);
            return vec3f(0.0);
        }
        case 4u: { // Phong
            let viewDir = normalize(-ray.direction);
            let reflectDir = reflect(-light.w_i, (*hitInfo).normal);
            let spec = pow(max(dot(viewDir, reflectDir), 0.0), (*hitInfo).shininess);
            let specular = (*hitInfo).color.specular * spec * ((*hitInfo).shininess + 2) / (2*PI);
            (*hitInfo).color.diffuse += specular;
            // (*hitInfo).color.diffuse *= light.L_i * ((*ray).direction * (*hitInfo).normal);
            break;
        }
        case 5u: { // Glossy (Refracted X Phong)
            let normalizedNormal = normalize((*hitInfo).normal);
            let normailzedDirection = normalize(ray.direction);
            if (dot(normalizedNormal, normailzedDirection) < 0.0) {
                (*hitInfo).indexOfRefraction = 1.0 / (*hitInfo).indexOfRefraction;
            } else {
                (*hitInfo).indexOfRefraction =  (*hitInfo).indexOfRefraction / 1.0;
                (*hitInfo).normal = -(*hitInfo).normal;
            }

            let refractedRayDirection = refract(ray.direction, (*hitInfo).normal, (*hitInfo).indexOfRefraction);
            *ray = Ray((*hitInfo).position - 1e-4 * (*hitInfo).normal, refractedRayDirection, 0, 1e5);
            (*hitInfo).has_hit = false;

            let viewDir = normalize(-ray.direction);
            let reflectDir = reflect(-light.w_i, (*hitInfo).normal);
            let spec = pow(max(dot(viewDir, reflectDir), 0.0), (*hitInfo).shininess);
            let specular = (*hitInfo).color.specular * spec * ((*hitInfo).shininess + 2) / (2*PI);
            (*hitInfo).color.diffuse += specular;
            // (*hitInfo).color.diffuse *= light.L_i * ((*ray).direction * (*hitInfo).normal);
            break;
        }
        default: {
            break;
        }
    }
    let n = normalize((*hitInfo).normal);
    let hitColor = (*hitInfo).color;

    var finalColor = vec3f(0.0);
    
    if (!inShadow) {
        let ndotl = max(dot(n, light.w_i), 0.0);
        // Lambert: Lo = (albedo/π) * Li * cosθ
        let direct_lighting = (hitColor.diffuse / PI) * light.L_i * ndotl;
        finalColor += direct_lighting;
    }

    return finalColor;
}

fn ray_plane_intersect(ray: Ray, planePoint: vec3f, onb: Onb, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let denom = dot(onb.normal, ray.direction);
    if (abs(denom) > 1e-4) {
        let t = dot(onb.normal, (planePoint - ray.origin)) / denom;
        if (t >= ray.tmin && t <= ray.tmax) {
            let position = ray.origin + t * ray.direction;
            let normal = normalize(onb.normal);
            let local = position - planePoint;
            let u = dot(local, onb.tangent);
            let v = dot(local, onb.binormal);
            let textureCord = vec2f(u, v) * uniforms.scaleFactor;
            var planeColor = vec3f(0.0);
            if (uniforms.filterMode == 0) {
                planeColor = vec3f(texture_nearest(my_texture,textureCord, uniforms.repeat == 1));
            } else if (uniforms.filterMode == 1) {
                planeColor = vec3f(texture_linear(my_texture, textureCord, uniforms.repeat == 1));
            }
            if (uniforms.useTexture == 0.0) {
                planeColor = color;
            }
            return HitInfo(true, t, position, normal, Color(vec3f(0.1,0.1,0.1) * planeColor,vec3f(0.9,0.9,0.9) * planeColor, vec3(0)), shader, index_of_refraction, shinyness);
        }
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
}


fn intersect_triangle(ray: Ray, face_index: u32) -> HitInfo {
    let face = meshFaces[face_index];
    let i0 = face.x;
    let i1 = face.y;
    let i2 = face.z;
    
    let v0 = vPositions[i0];
    let v1 = vPositions[i1];
    let v2 = vPositions[i2];
    
    let material_index = matIndices[face_index];
    let material = materials[material_index];
    
    let color = material.emission.xyz + material.diffuse.xyz;
    
    let shader = 2u;
    let shinyness = 1.0;
    let index_of_refraction = 1.5;
    
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    
    if (abs(a) < 0.0001) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let t = f * dot(edge2, q);
    if (t > ray.tmin && t < ray.tmax) {
        let position = ray.origin + ray.direction * t;
        
        let face_normal = normalize(cross(edge1, edge2));
        
        let colorAsDiffuse = Color(color * 0.1, color * 0.9, vec3f(0.0));
        return HitInfo(true, t, position, face_normal, colorAsDiffuse, shader, index_of_refraction, shinyness);
    }
    
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
}

fn ray_triangle_intersection(ray: Ray, v0: vec3f, v1: vec3f, v2: vec3f, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    if (abs(a) < 0.0001) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let t = f * dot(edge2, q);
    if (t > ray.tmin && t < ray.tmax) {
        let position = ray.origin + ray.direction * t;
        let normal = normalize(cross(edge1, edge2));
        let colorAsDiffuse = Color(color * 0.1, color * 0.9, vec3f(0.0));
        return HitInfo(true, t, position, normal, colorAsDiffuse, 2u, 1.5, 0.0);
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
}

fn ray_sphere_intersection(ray: Ray, sphereCenter: vec3f, sphereRadius: f32, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let oc = ray.origin - sphereCenter;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0 * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphereRadius * sphereRadius;
    let discriminant = b * b - 4.0 * a * c;

    if (discriminant < 0.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }
    let sqrtDisc = sqrt(discriminant);
    var t = (-b - sqrtDisc) / (2.0 * a);
    if (t < ray.tmin || t > ray.tmax) {
        t = (-b + sqrtDisc) / (2.0 * a);
        if (t < ray.tmin || t > ray.tmax) {
            return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
        }
    }
    let position = ray.origin + t * ray.direction;
    let normal = normalize(position - sphereCenter);
    let colorAsDiffuse = Color(color * 0.1, color * 0.9, vec3f(0.1));
    return HitInfo(true, t, position, normal, colorAsDiffuse, shader, index_of_refraction, shinyness);
}
