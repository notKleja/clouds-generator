/** A cheap 2D optical-thickness estimate, not a surface-normal or sphere shader. */
export function estimateShadows(alpha:Uint8ClampedArray,width:number,height:number,seed:number,angle:number):Float32Array {
  const noise=(x:number,y:number)=>{
    let h=Math.imul(x+seed,374761393)^Math.imul(y+1,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  };
  const smoothNoise=(x:number,y:number)=>{const ix=Math.floor(x),iy=Math.floor(y),a=x-ix,b=y-iy,u=a*a*(3-2*a),v=b*b*(3-2*b);return (noise(ix,iy)*(1-u)+noise(ix+1,iy)*u)*(1-v)+(noise(ix,iy+1)*(1-u)+noise(ix+1,iy+1)*u)*v;};
  const field=new Float32Array(width*height),variation=new Float32Array(field.length),result=new Float32Array(field.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,n=smoothNoise(x*.045,y*.045)*.65+smoothNoise(x*.11,y*.11)*.35;
    variation[i]=n;field[i]=alpha[i*4+3]/255*(.35+.65*n);
  }
  const sample=(x:number,y:number)=>{if(x<0||y<0||x>=width-1||y>=height-1)return 0;const ix=x|0,iy=y|0,u=x-ix,v=y-iy,i=iy*width+ix;return(field[i]*(1-u)+field[i+1]*u)*(1-v)+(field[i+width]*(1-u)+field[i+width+1]*u)*v;};
  const a=angle*Math.PI/180,dx=Math.cos(a),dy=-Math.sin(a),unit=Math.max(1,Math.min(width,height));
  const steps=[.06,.13,.22,.34,.5,.72];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,coverage=alpha[i*4+3]/255;if(coverage<.01)continue;
    let tau=0,previous=0;
    for(const step of steps){tau+=sample(x+dx*step*unit,y+dy*step*unit)*(step-previous)*4.5;previous=step;}
    result[i]=(1-Math.exp(-tau))*coverage*(.70+.30*variation[i]);
  }
  return result;
}
const linear=(v:number)=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
const encode=(v:number)=>Math.round(255*(v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055));
export function shadowPixels(field:Float32Array,color:string,strength:number):Uint8ClampedArray {
  const rgb=[1,3,5].map(i=>linear(parseInt(color.slice(i,i+2),16)/255)),pixels=new Uint8ClampedArray(field.length*4);
  const amount=Math.max(0,Math.min(100,strength))/100;
  for(let i=0;i<field.length;i++){
    // A cool indirect-light floor keeps dark areas luminous rather than black.
    for(let c=0;c<3;c++)pixels[i*4+c]=encode(rgb[c]*(1-field[i]*amount*[.68,.61,.51][c]));
    pixels[i*4+3]=255;
  }
  return pixels;
}
