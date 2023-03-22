import SwissGL from 'swissgl';
import { createSystem, buildWorld, queryEntities, ReadResource, WriteResource, With, Read, Storage, WriteEvents, ReadEvents } from 'sim-ecs';

const N = 64000;
const rootN = Math.round(Math.pow(N, 1/3));
const textureSize = [rootN, rootN, rootN];

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
  }
}

class Position {
  constructor(public x: number, public y: number, public z: number) {}
}

class Radius {
  constructor(public radius: number) {}
}

class TargetsUpdatedEvent {}

const Rendering = createSystem({
  spheres: queryEntities(With(Position), With(Radius)),
  context: Storage({
    sphereTargets: null,
    spheresCurrent: null,
  }),
  glStuff: ReadResource(GLResources),
  targetsUpdated: ReadEvents(TargetsUpdatedEvent),
}).withRunFunction(({context, spheres, glStuff, targetsUpdated}) => {
  const { glsl, canvas } = glStuff;
  
  // ensure the canvas is full screen
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const spheresArray = spheres.toArray();

  const spheresCurrent = glsl({}, {
    size: textureSize,
    format: 'rgba32f',
    story: 3,
    tag: 'spheresCurrent'
  })
  context.spheresCurrent = spheresCurrent;
  
  if (targetsUpdated.getOne()) {
    context.sphereTargets = glsl({
      // FP: 'FOut = ;',
    }, {
      data: new Float32Array(spheresArray.flatMap((sphere) => {
        const {x,y,z} = sphere.getComponent(Position)!;
        const {radius: value} = sphere.getComponent(Radius)!;
        return [x,y,z, value];
      })),
      tag: 'sphereTargets',
      size: textureSize,
      format: 'rgba32f'
    }) 
  }
  
  glsl({
    sphereTargets: context.sphereTargets,
    currentPositions: context.spheresCurrent![1],
    FP: 'FOut = mix(currentPositions(I), sphereTargets(I), 0.01);',
  }, context.spheresCurrent![0])

  glsl({
    spheresCurrent: context.spheresCurrent![0],
    FP: 'FOut = spheresCurrent(I);',
  })
    
  glsl({
    cameraYPD: [0,0,1],
    spheresCurrent: context.spheresCurrent![0], 
    Grid: (context.spheresCurrent![0] as any).size || [0,0],
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
        pos.xyz += normal*0.015;
        pos = wld2view(pos);
        // pos.xy += XY*0.03;  // offset quad corners in view space
        VOut = view2proj(pos);`,
      FP:`
        float r = length(XY)*3.0;
        // float alpha = smoothstep(1.0, 1.0-fwidth(r), r);
        float alpha = normal.z*0.7+0.3;

        FOut = vec4(color, alpha);`
    });

    // console.log(context.spheresCurrent)

}).withSetupFunction(({context, spheres, glStuff}) => {
}).build();

const randomTargets = createSystem({
  spheres: queryEntities(With(Position), With(Radius)),
  glResources: ReadResource(GLResources),
  updateTargets: WriteEvents(TargetsUpdatedEvent),
}).withSetupFunction(({spheres, glResources, updateTargets}) => {
  // whenever the user clicks the canvas we'll set new random targets for the spheres
  glResources.canvas.addEventListener('click', () => {
    spheres.execute((sphere) => {
      const position = sphere.getComponent(Position)!
      position.x = Math.random();
      position.y = Math.random();
      position.z = Math.random();
    })
    updateTargets.publish(new TargetsUpdatedEvent());
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

for (let i = 0; i < Math.pow(rootN,3); i++) {
  const sphere = prepWorld.createEntity();
  sphere.addComponent(Position, 0,0,0);
  sphere.addComponent(Radius, Math.random() * 0.5);
  // sphere.addComponent(SphereIndex, i);
}

prepWorld.prepareRun().then((runWorld) => {
  runWorld.start()
  runWorld.eventBus.publish(new TargetsUpdatedEvent());
});