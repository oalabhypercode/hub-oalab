"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";

/**
 * A person cut out of a talking video, for the welcome in the overview. The MP4 holds the colour in its top half and
 * the alpha channel as grey in its bottom half; WebGL joins them, so the cut-out works in every browser (Safari too,
 * which shows no alpha in WebM) and keeps the original sound. The still frame stands in until the first frame is
 * drawn, and stays wherever the video does not play. The video and WebGL only start on the first play().
 */
export type HostAvatarHandle = {
  /** Plays from the start; false if it cannot (no WebGL, blocked, missing file). Sound only works after a click. */
  play: (options?: { sound?: boolean }) => Promise<boolean>;
};

// Colour from the top half, alpha from the bottom half; `h` keeps the two halves from bleeding into each other.
const VERTEX = "attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
const FRAGMENT = "precision mediump float;uniform sampler2D t;uniform float h;varying vec2 uv;void main(){vec3 c=texture2D(t,vec2(uv.x,min(uv.y*.5,.5-h))).rgb;float a=texture2D(t,vec2(uv.x,max(.5+uv.y*.5,.5+h))).g;a=clamp((a-.03)/.94,0.,1.);gl_FragColor=vec4(c*a,a);}";

type Renderer = (video: HTMLVideoElement) => void;

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  const program = gl?.createProgram();
  if (!gl || !program) return null;
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const half = gl.getUniformLocation(program, "h");
  return (video) => {
    if (video.readyState < 2 || !video.videoWidth) return;
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight / 2;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(half, 1 / video.videoHeight);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
}

export function HostAvatar({ src, poster, ref, onTime, onEnded, className }: {
  src: string;
  poster: string;
  ref?: Ref<HostAvatarHandle>;
  onTime?: (seconds: number) => void;
  onEnded?: () => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const frame = useRef(0);
  const handlers = useRef({ onTime, onEnded });
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => { handlers.current = { onTime, onEnded }; });

  useEffect(() => {
    const video = videoRef.current;
    return () => { cancelAnimationFrame(frame.current); video?.pause(); };
  }, []);

  useImperativeHandle(ref, () => ({
    async play({ sound = false } = {}) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return false;
      renderer.current ??= createRenderer(canvas);
      const draw = renderer.current;
      if (!draw) return false;
      if (!video.getAttribute("src")) video.src = src;
      video.pause();
      video.currentTime = 0;
      video.muted = !sound;
      try {
        await video.play();
      } catch {
        if (!sound) return false;
        // Sound was refused after all: at least the picture.
        video.muted = true;
        try { await video.play(); } catch { return false; }
      }
      const tick = () => {
        draw(video);
        setDrawn(true);
        handlers.current.onTime?.(video.currentTime);
        if (video.paused || video.ended) return;
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
        else frame.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    },
  }), [src]);

  const ended = () => {
    const video = videoRef.current;
    if (video && renderer.current) renderer.current(video);
    handlers.current.onEnded?.();
  };

  return (
    <span className={className ? `host-avatar ${className}` : "host-avatar"} data-drawn={drawn ? "" : undefined} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- the cut-out still with its alpha, already the size it is shown at */}
      <img className="host-avatar-still" src={poster} alt="" draggable={false} />
      <canvas className="host-avatar-canvas" ref={canvasRef} />
      <video className="host-avatar-video" ref={videoRef} muted playsInline preload="none" onEnded={ended} />
    </span>
  );
}
