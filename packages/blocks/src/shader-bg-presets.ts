// Shared GLSL for the WebGL animated-background component (`data-sw-component="shader-bg"`).
//
// This module is the SINGLE SOURCE OF TRUTH for the shader presets. Three consumers read from it so
// they can never drift:
//   1. the published runtime — `shader-bg.ts` serialises these strings into `SHADER_BG_JS`;
//   2. the authoring contract — `@sitewright/schema` COMPONENT_CATALOG pins `data-preset` to the keys;
//   3. the editor preset picker — imports the presets + renderer for live WebGL thumbnails.
//
// Every preset is a single full-screen fragment shader (`render(uv, st)`), CI-themed via the three
// `uC*` palette uniforms. No geometry/camera/scene-graph, no `eval`/Workers/WASM — CSP-clean.

/** Trivial full-screen-quad vertex shader. */
export const SHADER_VERT = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.0,1.0); }';

/** GLSL prelude shared by every preset: uniforms + noise toolbox + the CI palette (`ciMix`). */
export const SHADER_PRELUDE = `
precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse;
uniform vec3 uC1, uC2, uC3;
uniform float uIntensity, uInteract, uAngle;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=rot(0.5)*p*2.02; a*=0.5; } return s; }
vec3 ciMix(float t){ t=clamp(t,0.0,1.0); return t<0.5 ? mix(uC1,uC2,t*2.0) : mix(uC2,uC3,(t-0.5)*2.0); }
`;

/** Shared `main()`: applies the global angle, saturation/brightness from `uIntensity`, writes the pixel. */
export const SHADER_MAIN = `
void main(){
  vec2 st = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  st = rot(uAngle) * st;                                   // global angle (rotates the whole frame)
  vec2 uv = vec2(st.x*(uRes.y/uRes.x) + 0.5, st.y + 0.5);  // uv derived from the rotated frame
  vec3 col = render(uv, st);
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, mix(0.55,1.45,uIntensity));   // saturation
  col *= mix(0.80,1.18,uIntensity);                      // brightness
  gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
}
`;

/** One animated-background preset. `glsl` defines `vec3 render(vec2 uv, vec2 st)`. */
export interface ShaderPreset {
  /** Stable kebab-case slug used as the `data-preset` value. */
  readonly key: string;
  /** Human label (editor picker, catalog). */
  readonly name: string;
  /** The preset's `render()` GLSL, concatenated between SHADER_PRELUDE and SHADER_MAIN. */
  readonly glsl: string;
}

export const SHADER_BG_PRESETS: readonly ShaderPreset[] = [
  { key: 'mesh-gradient', name: 'Mesh Gradient', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.3; vec2 p=st*1.2;
  vec2 a=vec2(sin(t*0.7),cos(t*0.6))*0.5 + uMouse*0.3;
  vec2 b=vec2(cos(t*0.5),sin(t*0.8))*0.5;
  vec2 c=vec2(sin(t*0.9+1.0),cos(t*0.4+2.0))*0.5;
  vec3 col=uC3;
  col=mix(col,uC1,smoothstep(1.1,0.0,length(p-a)));
  col=mix(col,uC2,smoothstep(1.1,0.0,length(p-b)));
  col=mix(col,mix(uC1,uC2,0.5),smoothstep(1.1,0.0,length(p-c))*0.85);
  return col;
}` },
  { key: 'silk-flow', name: 'Silk Flow', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.15; vec2 p=st*2.0 + uMouse*0.5;
  vec2 q=vec2(fbm(p+vec2(0.0,t)), fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+4.0*q+vec2(1.7,9.2)+t*0.5), fbm(p+4.0*q+vec2(8.3,2.8)));
  float f=fbm(p+4.0*r);
  return mix(ciMix(clamp(f*1.2,0.0,1.0)), uC2, r.x*0.5);
}` },
  { key: 'plasma', name: 'Plasma', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.6;
  float v=sin(st.x*4.0+t)+sin(st.y*4.0+t*1.1)+sin((st.x+st.y)*3.0+t*0.7)+sin(length(st-uMouse)*6.0-t);
  return ciMix(v*0.125+0.5);
}` },
  { key: 'halftone-pulse', name: 'Halftone Pulse', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.4; vec2 g=st*10.0; vec2 id=floor(g); vec2 f=fract(g)-0.5;
  float field=0.5+0.5*sin(id.x*0.5+id.y*0.4+t+fbm(id*0.2+t*0.1)*3.0);
  float r=0.10+0.30*field;
  r+=uInteract*0.16*smoothstep(2.5,0.0,length(st-uMouse)*4.0); // dots swell near cursor
  r=min(r,0.46);                                                // never larger than the cell -> no clipped edges
  float d=smoothstep(r,r-0.06,length(f));
  return mix(mix(uC3,uC3*1.1,uv.y), ciMix(field), d);
}` },
  { key: 'caustics', name: 'Caustics', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.4; vec2 p=st*3.0; float c=0.0;
  for(int i=0;i<3;i++){ float fi=float(i);
    vec2 q=p+vec2(fbm(p+t+fi),fbm(p-t+fi*2.0));
    c+=abs(sin(q.x*2.0)+sin(q.y*2.0));
  }
  c=pow(1.0-clamp(c*0.25,0.0,1.0),2.0);
  return mix(uC3, ciMix(0.4)+uC2*0.35, 0.6) + c*(uC1+uC2)*0.6;
}` },
  { key: 'marble-ink', name: 'Marble Ink', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.1;
  float n=fbm(st*2.0+fbm(st*2.0+vec2(t,0.0)+uMouse*0.4)*2.0);
  return ciMix(0.5+0.5*sin((st.x+n*3.0)*3.1415+t));
}` },
  { key: 'sun-rays', name: 'Sun Rays', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.5;
  vec2 p=st;                                          // always centred
  float a=atan(p.y,p.x) + t + (rot(-uAngle)*uMouse).x*3.1416; // rays rotate; cursor steers the angle (angle-stable)
  float r=length(p);
  float rays=pow(0.5+0.5*sin(a*12.0),2.0);
  float core=exp(-r*1.1);
  return mix(uC3,ciMix(0.3),0.5) + ciMix(0.6)*rays*core*1.5 + uC1*core*0.5;
}` },
  { key: 'lava-lamp', name: 'Lava Lamp', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.2; float f=0.0;
  for(int i=0;i<4;i++){ float fi=float(i);
    vec2 c=vec2(0.5*sin(t*0.4+fi*2.0), 0.7*sin(t*0.3+fi*1.5+fi));
    float rr=0.5+0.2*sin(t+fi);
    f+=smoothstep(rr,rr-0.5,length((st-c)*vec2(1.0,0.8)));
  }
  return mix(uC3, ciMix(clamp(f*0.4,0.0,1.0)), smoothstep(0.6,1.0,f));
}` },
  { key: 'corner-mesh', name: 'Corner Mesh', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.25; vec2 m=uMouse*0.18;
  vec2 q=uv + 0.08*vec2(sin(t+uv.y*3.0), cos(t*0.8+uv.x*3.0)) + m;
  q=clamp(q,0.0,1.0);
  vec3 top=mix(uC1,uC2,q.x);
  vec3 bot=mix(uC3, mix(uC2,uC1,0.5), q.x);
  return mix(bot, top, q.y);
}` },
  { key: 'flow-field', name: 'Flow Field', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.2; vec2 p=st*1.5 + uMouse*0.5;
  float a=fbm(p+vec2(t,0.0))*6.2831;
  vec2 dir=vec2(cos(a),sin(a));
  float lines=pow(0.5+0.5*sin((st.x*dir.y-st.y*dir.x)*30.0+t*4.0),3.0);
  vec3 col=ciMix(0.5+0.5*sin(a));
  return mix(uC3,col,0.4) + col*lines*0.5;
}` },
  { key: 'interference', name: 'Interference', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.8; float asp=uRes.x/uRes.y;
  vec2 L=vec2(-asp*0.5,0.0), R=vec2(asp*0.5,0.0);
  float w=sin(length(st-L)*14.0-t)+sin(length(st-R)*14.0-t)+0.6*sin(length(st-uMouse)*14.0-t);
  return ciMix(w*0.18+0.5);
}` },
  { key: 'ribbons', name: 'Ribbons', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.3; float d=(uv.x*0.7+uv.y*0.7); vec3 col=uC3;
  for(int i=0;i<5;i++){ float fi=float(i);
    float band=sin((d*4.0 + fbm(st*1.5+t+fi))*3.1415 - t + fi*0.2);
    col=mix(col, ciMix(0.5-0.5*cos(6.2831853*(fi*0.2+t*0.1))), smoothstep(0.85,1.0,band)*0.7);
  }
  return col;
}` },
  { key: 'brushed-streaks', name: 'Brushed Streaks', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.5;
  float streak=fbm(vec2(st.x*2.0-t, st.y*40.0));
  vec3 col=ciMix(uv.x+0.15*sin(t));
  return mix(uC3, mix(col, col*1.3, streak), 0.85);
}` },
  { key: 'voronoi-cells', name: 'Voronoi Cells', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.3; vec2 p=st*4.0; vec2 g=floor(p), f=fract(p);
  vec2 mp=uMouse*4.0;                                   // cursor in cell space
  float f1=8.0, f2=8.0; vec2 mc=vec2(0.0);
  for(int y=-1;y<=1;y++){ for(int x=-1;x<=1;x++){
    vec2 o=vec2(float(x),float(y));
    vec2 fp=0.5+0.5*sin(t+6.2831*hash22(g+o));
    vec2 fpw=g+o+fp;
    float w=uInteract*0.7*exp(-dot(fpw-mp,fpw-mp)*1.2); // cursor swells the hovered cell
    float d=length(o+fp-f) - w;
    if(d<f1){ f2=f1; f1=d; mc=g+o; } else if(d<f2){ f2=d; }
  }}
  float edge=smoothstep(0.0,0.06,f2-f1);                // dark leading between cells, no centre dots
  vec3 col=ciMix(fract(hash21(mc)));
  return mix(uC3,col,0.5)*mix(0.5,1.0,edge);
}` },
  { key: 'pointer-ripples', name: 'Pointer Ripples', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime; float d=length(st-uMouse);
  float r=sin(d*22.0-t*4.0)*exp(-d*1.2);
  vec3 col=mix(uC3, ciMix(0.5+0.4*r), 0.6);
  return col + ciMix(0.7)*r*0.4;
}` },
  { key: 'liquid-metal', name: 'Liquid Metal', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.15;
  float n=fbm(st*2.0 + fbm(st*1.5+vec2(t,t*0.7))*1.5);
  float spec=pow(0.5+0.5*sin(n*9.0+t*2.0),4.0);
  return ciMix(n) + spec*0.6;
}` },
  { key: 'rising-smoke', name: 'Rising Smoke', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.3; vec2 p=vec2(st.x*1.5, uv.y*2.0 - t);
  float d=fbm(p + fbm(p*0.5)*1.5);
  float dens=d*(1.0-uv.y*0.55);
  return mix(uC3, ciMix(0.5+0.3*d), clamp(dens,0.0,1.0));
}` },
  { key: 'edge-glow', name: 'Edge Glow', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.4;
  float L=smoothstep(0.55,0.0,uv.x)*(0.6+0.4*sin(t));
  float R=smoothstep(0.45,1.0,uv.x)*(0.6+0.4*sin(t+1.5));
  float T=smoothstep(0.45,1.0,uv.y)*(0.6+0.4*sin(t+3.0));
  float B=smoothstep(0.55,0.0,uv.y)*(0.6+0.4*sin(t+4.5));
  vec3 col=uC3;
  col+=uC1*L*0.6; col+=uC2*R*0.6; col+=mix(uC1,uC2,0.5)*T*0.5; col+=uC2*B*0.4;
  return col;
}` },
  { key: 'waterfall', name: 'Waterfall', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.6;
  float streak=fbm(vec2(st.x*8.0, uv.y*2.0 + t));
  vec3 col=ciMix(uv.y);
  return mix(col, col*1.4, smoothstep(0.4,0.9,streak));
}` },
  { key: 'heat-haze', name: 'Heat Haze', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.5;
  float heat=uInteract*smoothstep(0.8,0.0,length(st-uMouse));
  vec2 warp=vec2(fbm(st*3.0+t), fbm(st*3.0-t))*(0.1+heat*0.35);
  float g=fbm((st+warp)*2.0);
  return mix(ciMix(uv.x+warp.x), ciMix(0.7), g*0.4);
}` },
  { key: 'bokeh-drift', name: 'Bokeh Drift', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.15;
  vec3 col=mix(uC3, ciMix(0.2), uv.y);
  for(int i=0;i<6;i++){ float fi=float(i);
    vec2 c=vec2(sin(t*0.6+fi*2.1)*0.85, cos(t*0.5+fi*1.7)*0.5);
    float r=0.18+0.12*sin(fi*1.3);
    float orb=smoothstep(r, r*0.2, length(st-c));
    col += ciMix(fract(0.2+fi*0.17))*orb*0.18;
  }
  return col;
}` },
  { key: 'contours', name: 'Contours', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.1;
  float h=fbm(st*1.8 + vec2(t,0.0) + uMouse*0.4);
  vec3 base=ciMix(h);
  float lines=abs(fract(h*8.0)-0.5)*2.0;
  float iso=smoothstep(0.12,0.0,lines);
  return mix(mix(uC3,base,0.6), ciMix(0.75)+0.15, iso*0.7);
}` },
  { key: 'starfield', name: 'Starfield', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.05;
  vec3 col=mix(uC3, uC3*0.6, uv.y);
  float stars=0.0;
  for(int i=0;i<3;i++){ float fi=float(i);
    vec2 p=st*(3.0+fi*3.0) + vec2(t*(1.0+fi), 0.0) + uMouse*0.2*fi;
    vec2 g=floor(p);
    vec2 rnd=hash22(g)-0.5;
    float d=length((fract(p)-0.5)-rnd*0.6);
    float tw=0.5+0.5*sin(t*30.0+hash21(g)*6.2831);
    stars+=smoothstep(0.08,0.0,d)*tw*(0.6-fi*0.15);
  }
  return col + (uC1+uC2)*0.5*stars;
}` },
  { key: 'sine-strands', name: 'Sine Strands', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.5; vec3 col=uC3;
  for(int i=0;i<6;i++){ float fi=float(i);
    float y=0.15+fi*0.14;
    float wob=0.06*sin(st.x*2.0 + t + fi) + 0.04*fbm(vec2(st.x*1.5+t*0.3, fi));
    float line=smoothstep(0.03,0.0,abs(uv.y-(y+wob)));
    col=mix(col, ciMix(0.5-0.5*cos(6.2831853*(fi*0.16+t*0.05))), line);
  }
  return col;
}` },
  { key: 'vortex-swirl', name: 'Vortex Swirl', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.2; float r=length(st);
  float swirl=(1.5 + (rot(-uAngle)*uMouse).x*2.0)/(r+0.4);
  float a=atan(st.y,st.x) + swirl + t;
  vec2 p=vec2(cos(a),sin(a))*r;
  float n=fbm(p*2.0 + t*0.3);
  return ciMix(0.5+0.5*sin(n*3.0 + a));
}` },
  { key: 'ink-bloom', name: 'Ink Bloom', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.15;
  float r=length(st - uMouse*0.5);
  float edge=fbm(st*3.0 + t)*0.4;
  float bloom=smoothstep(0.8+edge, 0.2+edge, r + 0.1*sin(t));
  return mix(uC3, ciMix(0.55), bloom) + ciMix(0.3)*bloom*0.3;
}` },
  { key: 'mist-layers', name: 'Mist Layers', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.1; vec3 col=mix(ciMix(0.15), uC3, uv.y);
  for(int i=0;i<4;i++){ float fi=float(i);
    float band=fbm(vec2(st.x*(0.8+fi*0.3) + t*(0.2+fi*0.15) + uMouse.x*0.1*fi, fi*3.0 + uv.y*1.5));
    float y=0.25+fi*0.18;
    float m=smoothstep(0.4,1.0,band)*exp(-pow((uv.y-y)*3.0,2.0));
    col=mix(col, ciMix(0.4+fi*0.1), m*0.5);
  }
  return col;
}` },
  { key: 'drifting-blobs', name: 'Drifting Blobs', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.25;
  vec2 b0=vec2(sin(t*0.7),cos(t*0.5))*0.6;
  vec2 b1=vec2(cos(t*0.4+1.0),sin(t*0.6+2.0))*0.6;
  vec2 b2=uMouse*0.8;
  vec3 col=uC3*0.5;
  col += uC1*smoothstep(0.9,0.0,length(st-b0))*0.9;
  col += uC2*smoothstep(0.9,0.0,length(st-b1))*0.9;
  col += mix(uC1,uC2,0.5)*smoothstep(0.7,0.0,length(st-b2))*0.9;
  return col;
}` },
  { key: 'glow-orbits', name: 'Glow Orbits', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.6; vec3 col=uC3*0.6;
  for(int i=0;i<5;i++){ float fi=float(i);
    float rad=0.25+fi*0.13;
    float sp=t*(1.0-fi*0.12) + fi*1.7 + (rot(-uAngle)*uMouse).x*2.0;
    vec2 c=vec2(cos(sp),sin(sp))*rad;
    col += ciMix(fract(0.1+fi*0.2))*exp(-length(st-c)*8.0)*0.7;
  }
  col += ciMix(0.6)*exp(-length(st)*4.0)*0.4;
  return col;
}` },
  { key: 'gradient-flow', name: 'Gradient Flow', glsl: `
vec3 render(vec2 uv, vec2 st){
  float t=uTime*0.15;
  vec2 q=vec2(fbm(st*1.2+vec2(0.0,t)+uMouse*0.3), fbm(st*1.2+vec2(3.0,-t)));
  float f=fbm(st*1.2 + q*1.5);
  vec3 col=mix(uC1,uC2,smoothstep(0.2,0.8,f));
  col=mix(col,uC3,smoothstep(0.5,0.0,f)*0.6);
  return col;
}` },
] as const;

/** Stable preset keys (the allowed `data-preset` values), in display order. */
export const SHADER_BG_PRESET_KEYS: readonly string[] = SHADER_BG_PRESETS.map((p) => p.key);

/** The default preset when `data-preset` is missing or unknown. */
export const DEFAULT_SHADER_PRESET = 'mesh-gradient';

/** The first preset, used as the ultimate fallback (the list is always non-empty). */
const FIRST_PRESET = SHADER_BG_PRESETS[0] as ShaderPreset;

/** Look up a preset by key, falling back to the default. */
export function shaderPresetByKey(key: string | null | undefined): ShaderPreset {
  return (
    SHADER_BG_PRESETS.find((p) => p.key === key) ??
    SHADER_BG_PRESETS.find((p) => p.key === DEFAULT_SHADER_PRESET) ??
    FIRST_PRESET
  );
}

/** Full fragment-shader source for a preset (prelude + render + main). */
export function shaderFragmentSource(preset: ShaderPreset): string {
  return SHADER_PRELUDE + preset.glsl + SHADER_MAIN;
}
