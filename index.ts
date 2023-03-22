import SwissGL from 'swissgl';
import { createSystem, buildWorld, queryEntities, ReadResource, WriteResource, With, Read, Storage, WriteEvents, ReadEvents } from 'sim-ecs';

const N = 500000;
const rootN = Math.round(Math.pow(N, 1/3));
const textureSize = [rootN, rootN, rootN];
const size = Math.pow(rootN, 3);

class GLResources {
  canvas: HTMLCanvasElement;
  glsl: SwissGL;
  constructor(){
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.id = 'c';
    document.body.appendChild(this.canvas);
    this.glsl = SwissGL(this.canvas);
  };
  sphereTargets: null;
  spheresCurrent: null;
}

class SpheresResource {
  constructor(public spheres : Uint8Array){
    this.spheres = new Uint8Array(size*4);
  }
}

class TargetsUpdatedEvent {}

const Rendering = createSystem({
  glStuff: ReadResource(GLResources),
  spheresResource: ReadResource(SpheresResource),
  targetsUpdated: ReadEvents(TargetsUpdatedEvent),
}).withRunFunction(({spheresResource, glStuff, targetsUpdated}) => {
  const { glsl, canvas } = glStuff;
  
  // ensure the canvas is full screen
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const spheres = spheresResource.spheres;

  const spheresCurrent = glsl({}, {
    size: textureSize,
    format: 'rgba32f',
    story: 3,
    tag: 'spheresCurrent'
  })
  glStuff.spheresCurrent = spheresCurrent;
  
  
  glsl({
    sphereTargets: glStuff.sphereTargets,
    currentPositions: glStuff.spheresCurrent![1],
    FP: 'FOut = mix(currentPositions(I), sphereTargets(I), 0.2);',
  }, glStuff.spheresCurrent![0])

  glsl({
    spheresCurrent: glStuff.spheresCurrent![0],
    FP: 'FOut = spheresCurrent(I);',
  })
    
  glsl({
    cameraYPD: [0,0,1],
    spheresCurrent: glStuff.spheresCurrent![0], 
    Grid: (glStuff.spheresCurrent![0] as any).size || [0,0],
    Mesh: [8,8],
    Clear:[0.2, 0.2, 0.3, 1],
    Aspect:'fit', DepthTest:1, AlphaCoverage:1,
      Inc:`
          uniform vec3 cameraYPD;
          uniform bool xrMode;
          uniform mat4 xrProjectionMatrix, xrViewMatrix;
          uniform vec3 xrPosition;
          varying vec3 normal;

          vec3 cameraPos() {
              if (xrMode) return xrPosition;
              vec3 p = vec3(0, 0, cameraYPD.z);
          p.yz *= rot2(-cameraYPD.y);
              p.xy *= rot2(-cameraYPD.x);
              return p;
          }
          vec4 wld2view(vec4 p) {
              if (xrMode) return xrViewMatrix * p;
              p.xy *= rot2(cameraYPD.x);
              p.yz *= rot2(cameraYPD.y);
              p.z -= cameraYPD.z;
              return p;
          }
          vec4 view2proj(vec4 p) {
              if (xrMode) return xrProjectionMatrix*p;
              const float near = 0.1, far = 10.0, fov = 1.0;
              return vec4(p.xy/tan(fov/2.0),
                  (p.z*(near+far)+2.0*near*far)/(near-far), -p.z);
          }
          vec4 wld2proj(vec4 p) {
              return view2proj(wld2view(p));
          }

        varying vec3 color;`,
      VP:`
        vec3 p = color = spheresCurrent(ID.xy).rgb;
        vec4 pos = vec4(p-0.5, 1);
        normal = uv2sphere(UV);
        pos.xyz += normal*0.008;
        pos = wld2view(pos);
        // pos.xy += XY*0.03;  // offset quad corners in view space
        VOut = view2proj(pos);`,
      FP:`
        // float r = length(XY)*10.0;
        // float alpha = smoothstep(1.0, 1.0-fwidth(r), r);
        float alpha = normal.z*0.7+0.3;

        FOut = vec4(color, alpha);`
    });

    // console.log(context.spheresCurrent)

}).withSetupFunction(({glStuff}) => {
}).build();

const randomTargets = createSystem({
  glResources: ReadResource(GLResources),
  spheresResource: WriteResource(SpheresResource),
  updateTargets: WriteEvents(TargetsUpdatedEvent),
}).withSetupFunction(({spheresResource, glResources, updateTargets}) => {
  // whenever the user clicks the canvas we'll set new random targets for the spheres
  const { glsl } = glResources;
  glResources.canvas.addEventListener('click', () => {
    spheresResource.spheres.set(spheresResource.spheres.map((x) => Math.random()*256.0))
    glResources.sphereTargets = glsl({}, {
      data: spheresResource.spheres,
      tag: 'sphereTargets',
      size: textureSize,
      format: 'rgba8'
    }) 
  })
}).build();

const prepWorld = buildWorld()
.withDefaultScheduling(root => root
  .addNewStage(stage => stage
      .addSystem(Rendering)
      .addSystem(randomTargets)
  )
)
.build();
prepWorld.addResource(GLResources);
prepWorld.addResource(SpheresResource);

prepWorld.prepareRun().then((runWorld) => {
  runWorld.start()
  runWorld.eventBus.publish(new TargetsUpdatedEvent());
});