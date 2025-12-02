a)

- Flat shading: Lighting is calculated once per triangle using the triangle’s normal. Every pixel on the triangle has the same color, so it looks blocky.
- Gouraud shading: Lighting is calculated at each vertex of the triangle, then the colors are blended across the triangle. It’s fast, but shiny spots can look weird or be missing.
- Phong shading: Normals are blended across the triangle, and lighting is calculated for every pixel. This makes smooth colors and shiny spots look round and realistic.

- Best for highlights: Phong shading is best. Gouraud can miss or distort shiny spots.

b)

- Directional light: Light comes from one direction, like sunlight. All rays are parallel, and brightness doesn’t change with distance.
- Point light: Light comes from a single point, like a lightbulb. Rays spread out, and brightness gets weaker as you move away.

c)

- Yes for specular terms (they depend on the view direction).
- No for pure diffuse (Lambert) and ambient terms.

d)
- The specular highlight disappears. The surface looks matte (diffuse + ambient only).

e)
- The highlight becomes smaller, tighter and brighter.
- Lower s → broader, duller highlight.

f)
- We computed everything in world space, and simply passed the eye position as a uniform to the shader.