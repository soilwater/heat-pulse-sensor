/* Temperature of ideal soil around the heater, not resistor/steel temperature.
 * A fixed logarithmic rise scale reveals the small side-needle signal without
 * changing scale as a pulse cools. The needle interior has no soil-model value.
 */
(() => {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const LIGHT=[[246,235,247],[174,86,194],[225,63,107],[252,115,57],[255,211,100]];
  const DARK=[[70,24,110],[174,86,194],[245,63,120],[255,125,50],[255,226,110]]; // same ramp, starts dark on a dark sheet
  let stops=LIGHT;
  const scale=rise=>Math.max(0,Math.min(1,Math.log1p(Math.max(0,rise)/.05)/Math.log(101)));
  function color(rise) {
    const index=scale(rise)*4,lo=Math.min(3,Math.floor(index)),f=index-lo;
    return stops[lo].map((v,i)=>Math.round(v+(stops[lo+1][i]-v)*f));
  }
  function mount(parent,board) {
    const image=document.createElementNS(NS,'image');
    const heater=board.footprints.find(p=>p.ref==='RH1');
    const left=board.bodyLengthMm+8,top=heater.xy[1]-16,width=59,height=32;
    for(const [key,value] of Object.entries({id:'thermalField',x:left,y:top,width,height,
      'pointer-events':'none',preserveAspectRatio:'none',opacity:0}))image.setAttribute(key,value);
    parent.append(image);
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=56;
    const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);
    let previousRun=null,previousTime=null,previousStops=null;
    return {
      refresh(){previousRun=null;},
      update(state,run) {
        stops=document.documentElement.dataset.theme==='dark'?DARK:LIGHT;
        const t=Math.floor(state.timeS*4)/4;
        if(run===previousRun&&t===previousTime&&stops===previousStops)return;
        previousRun=run;previousTime=t;previousStops=stops;
        let maximum=0;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
          const r=Math.abs(top+(y+.5)/canvas.height*height-heater.xy[1]);
          const z=left+(x+.5)/canvas.width*width-board.bodyLengthMm;
          const rise=r<1.385?0:Math.max(0,SensorModel.temperatureAtPosition(run,t,r,z)-run.config.ambientC);
          const i=(y*canvas.width+x)*4,rgb=color(rise);
          pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
          pixels.data[i+3]=rise<.005?0:Math.round(210*Math.min(1,rise/.05));
          maximum=Math.max(maximum,rise);
        }
        context.putImageData(pixels,0,0);
        image.setAttribute('href',canvas.toDataURL('image/png'));
        image.setAttribute('opacity',maximum>.005?'1':'0');
        image.dataset.maximumRise=maximum.toFixed(4);
        image.dataset.time=t;
      }
    };
  }
  window.SensorHeatmap={mount,color,scale};
})();
