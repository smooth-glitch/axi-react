"use client";
import React, { useEffect, useRef, useState } from "react";
import { User, Lock, ArrowRight } from "lucide-react";

// Vertex shader source code
const vertexSmokeySource = `
  attribute vec4 a_position;
  void main() {
    gl_Position = a_position;
  }
`;

// Fragment shader source code for the ultra-smooth 120fps fluid smokey effect
const fragmentSmokeySource = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform vec2 iMouse;
uniform vec3 u_color;
uniform vec3 u_bgColor;
uniform vec3 u_accentColor;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (2.0 * fragCoord - iResolution.xy) / min(iResolution.x, iResolution.y);

    // Silky smooth time progression
    float t = iTime * 0.28;

    // Smooth normalized mouse offset
    vec2 m = (iMouse / iResolution.xy) * 2.0 - 1.0;
    m.y = -m.y;

    // Organic domain warping without sharp pinch lines
    vec2 d = p * 0.88;
    float dist = length(p - m * 0.85);
    float mouseGlow = exp(-dist * 1.3) * 0.24;

    for (float i = 1.0; i <= 6.0; i += 1.0) {
        float fi = i * 1.35;
        d.x += (0.36 / i) * sin(fi * d.y + t * 0.48 + m.x * 0.45) + mouseGlow * 0.12;
        d.y += (0.36 / i) * cos(fi * d.x + t * 0.42 + m.y * 0.45) + mouseGlow * 0.12;
    }

    // 3 continuous sinusoidal waves without abs() folds
    float wave1 = 0.5 + 0.5 * sin(d.x * 1.15 + d.y * 0.85 + t * 0.42);
    float wave2 = 0.5 + 0.5 * cos(d.y * 1.25 - d.x * 0.75 + t * 0.36);
    float wave3 = 0.5 + 0.5 * sin((d.x + d.y) * 0.75 - t * 0.22);

    // Butter-smooth sigmoid / cosine blending
    float flow = smoothstep(0.08, 0.92, wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2);
    float highlight = smoothstep(0.42, 0.96, wave1 * wave2);

    // Tri-color pearlescent liquid interpolation across Sandesh coral/peach
    vec3 col = mix(u_bgColor, u_color, flow * 0.74);
    col = mix(col, u_accentColor, highlight * 0.42);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

/**
 * Valid blur sizes supported by Tailwind CSS.
 */
export type BlurSize = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/**
 * Props for the SmokeyBackground component.
 */
export interface SmokeyBackgroundProps {
  backdropBlurAmount?: BlurSize | string;
  color?: string;
  backgroundColor?: string;
  accentColor?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A mapping from blur size names to Tailwind CSS classes.
 */
const blurClassMap: Record<BlurSize, string> = {
  none: "backdrop-blur-none",
  sm: "backdrop-blur-sm",
  md: "backdrop-blur-md",
  lg: "backdrop-blur-lg",
  xl: "backdrop-blur-xl",
  "2xl": "backdrop-blur-2xl",
  "3xl": "backdrop-blur-3xl",
};

/**
 * A React component that renders an interactive WebGL shader background.
 */
export function SmokeyBackground({
  backdropBlurAmount = "md",
  color = "#ff7a59", // Sandesh coral accent
  backgroundColor = "#fff3eb", // Sandesh peach background
  accentColor = "#ff5757", // Soft warm coral highlight
  className = "",
  children,
}: SmokeyBackgroundProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseTargetRef = useRef({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 500,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 400,
    active: false,
  });
  const mouseSmoothRef = useRef({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 500,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 400,
  });

  // Helper to convert hex color to RGB (0-1 range)
  const hexToRgb = (hex: string): [number, number, number] => {
    if (!hex || !hex.startsWith("#")) return [0, 0, 0];
    const cleanHex = hex.replace("#", "");
    if (cleanHex.length === 3) {
      const r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
      const g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
      const b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
      return [r, g, b];
    }
    if (cleanHex.length >= 6) {
      const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
      const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
      const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
      return [r, g, b];
    }
    return [0, 0, 0];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!gl) {
      console.warn("WebGL not supported for SmokeyBackground");
      return;
    }

    const compileShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSmokeySource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSmokeySource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program linking error:", gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const iResolutionLocation = gl.getUniformLocation(program, "iResolution");
    const iTimeLocation = gl.getUniformLocation(program, "iTime");
    const iMouseLocation = gl.getUniformLocation(program, "iMouse");
    const uColorLocation = gl.getUniformLocation(program, "u_color");
    const uBgColorLocation = gl.getUniformLocation(program, "u_bgColor");
    const uAccentColorLocation = gl.getUniformLocation(program, "u_accentColor");

    const startTime = performance.now();
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(uColorLocation, r, g, b);

    const [bgR, bgG, bgB] = hexToRgb(backgroundColor);
    if (uBgColorLocation) {
      gl.uniform3f(uBgColorLocation, bgR, bgG, bgB);
    }

    const [acR, acG, acB] = hexToRgb(accentColor || "#ff5757");
    if (uAccentColorLocation) {
      gl.uniform3f(uAccentColorLocation, acR, acG, acB);
    }

    let animationId: number;

    const render = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor((canvas.clientWidth || window.innerWidth) * dpr);
      const height = Math.floor((canvas.clientHeight || window.innerHeight) * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);

      // Butter-smooth spring-lerp mouse tracking at native refresh rate (up to 120/144Hz)
      const target = mouseTargetRef.current;
      const smooth = mouseSmoothRef.current;
      smooth.x += (target.x - smooth.x) * 0.055;
      smooth.y += (target.y - smooth.y) * 0.055;

      const currentTime = (now - startTime) / 1000;

      gl.uniform2f(iResolutionLocation, width, height);
      gl.uniform1f(iTimeLocation, currentTime);
      gl.uniform2f(
        iMouseLocation,
        target.active ? smooth.x * dpr : width / 2,
        target.active ? (height - smooth.y * dpr) : height / 2
      );

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationId = requestAnimationFrame(render);
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouseTargetRef.current.x = event.clientX;
      mouseTargetRef.current.y = event.clientY;
      mouseTargetRef.current.active = true;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    animationId = requestAnimationFrame(render);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener("mousemove", handleMouseMove);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, [color, backgroundColor, accentColor]);

  const blurStyleMap: Record<BlurSize, string> = {
    none: "none",
    sm: "blur(4px)",
    md: "blur(8px)",
    lg: "blur(16px)",
    xl: "blur(24px)",
    "2xl": "blur(40px)",
    "3xl": "blur(64px)",
  };

  const finalBlurClass = blurClassMap[backdropBlurAmount as BlurSize] || "backdrop-blur-sm";
  const blurFilterValue =
    typeof backdropBlurAmount === "string" && blurStyleMap[backdropBlurAmount as BlurSize]
      ? blurStyleMap[backdropBlurAmount as BlurSize]
      : "blur(4px)";

  return (
    <div
      className={`sandesh-webgl-smokey-container ${className}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "auto",
        }}
      />
      <div
        className={finalBlurClass}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          backdropFilter: blurFilterValue,
          WebkitBackdropFilter: blurFilterValue,
        }}
      />
      {children}
    </div>
  );
}

/**
 * Props for LoginForm component
 */
export interface LoginFormProps {
  onSignIn?: (email: string, pass: string) => void;
  onGoogleSignIn?: () => void;
  accentColor?: string;
  theme?: "sandesh" | "dark";
}

/**
 * A glassmorphism-style login form component with animated labels and Google login.
 */
export function LoginForm({
  onSignIn,
  onGoogleSignIn,
  theme = "sandesh",
}: LoginFormProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSignIn) {
      onSignIn(email, password);
    }
  };

  const isSandesh = theme === "sandesh";

  return (
    <div
      className={`w-full max-w-sm p-8 space-y-6 rounded-2xl shadow-2xl transition-all duration-300 ${
        isSandesh
          ? "bg-[rgba(255,255,255,0.75)] backdrop-blur-[28px] border border-[rgba(255,255,255,0.85)] shadow-[0_20px_50px_rgba(255,122,89,0.18)]"
          : "bg-white/10 backdrop-blur-lg border border-white/20"
      }`}
      style={
        isSandesh
          ? {
              boxShadow:
                "0 25px 60px -10px rgba(220, 110, 65, 0.22), inset 0 1.5px 1px rgba(255, 255, 255, 0.95)",
            }
          : undefined
      }
    >
      <div className="text-center">
        <h2
          className={`text-3xl font-bold tracking-tight ${
            isSandesh ? "text-[#1f2937]" : "text-white"
          }`}
        >
          Welcome Back
        </h2>
        <p
          className={`mt-2 text-sm ${
            isSandesh ? "text-[#64748b]" : "text-gray-300"
          }`}
        >
          Sign in to continue
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email Input with Animated Label */}
        <div className="relative z-0">
          <input
            type="email"
            id="floating_email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`block py-2.5 px-0 w-full text-sm bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 peer transition-colors ${
              isSandesh
                ? "text-[#1f2937] border-[#ffd3bd] focus:border-[#ff7a59]"
                : "text-white border-gray-300 focus:border-blue-500"
            }`}
            placeholder=" "
            required
          />
          <label
            htmlFor="floating_email"
            className={`absolute text-sm duration-300 transform -translate-y-6 scale-75 top-3 -z-10 origin-[0] peer-focus:left-0 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-6 ${
              isSandesh
                ? "text-[#64748b] peer-focus:text-[#ff7a59]"
                : "text-gray-300 peer-focus:text-blue-400"
            }`}
          >
            <User className="inline-block mr-2 -mt-1" size={16} />
            Email Address
          </label>
        </div>

        {/* Password Input with Animated Label */}
        <div className="relative z-0">
          <input
            type="password"
            id="floating_password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`block py-2.5 px-0 w-full text-sm bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 peer transition-colors ${
              isSandesh
                ? "text-[#1f2937] border-[#ffd3bd] focus:border-[#ff7a59]"
                : "text-white border-gray-300 focus:border-blue-500"
            }`}
            placeholder=" "
            required
          />
          <label
            htmlFor="floating_password"
            className={`absolute text-sm duration-300 transform -translate-y-6 scale-75 top-3 -z-10 origin-[0] peer-focus:left-0 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-6 ${
              isSandesh
                ? "text-[#64748b] peer-focus:text-[#ff7a59]"
                : "text-gray-300 peer-focus:text-blue-400"
            }`}
          >
            <Lock className="inline-block mr-2 -mt-1" size={16} />
            Password
          </label>
        </div>

        <div className="flex items-center justify-between">
          <a
            href="#"
            className={`text-xs transition hover:underline ${
              isSandesh
                ? "text-[#ff7a59] hover:text-[#ff6540]"
                : "text-gray-300 hover:text-white"
            }`}
          >
            Forgot Password?
          </a>
        </div>

        <button
          type="submit"
          className={`group w-full flex items-center justify-center py-3 px-4 rounded-xl text-white font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-300 shadow-md ${
            isSandesh
              ? "bg-gradient-to-r from-[#ff7a59] to-[#ff5757] hover:from-[#ff6540] hover:to-[#e6532e] active:scale-[0.99] shadow-[0_4px_14px_rgba(255,122,89,0.35)] focus:ring-[#ff7a59]"
              : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
          }`}
        >
          Sign In
          <ArrowRight className="ml-2 h-5 w-5 transform group-hover:translate-x-1 transition-transform" />
        </button>

        {/* Divider */}
        <div className="relative flex py-2 items-center">
          <div
            className={`flex-grow border-t ${
              isSandesh ? "border-[#ffd3bd]/60" : "border-gray-400/30"
            }`}
          />
          <span
            className={`flex-shrink mx-4 text-xs font-medium tracking-wider uppercase ${
              isSandesh ? "text-[#94a3b8]" : "text-gray-400"
            }`}
          >
            OR CONTINUE WITH
          </span>
          <div
            className={`flex-grow border-t ${
              isSandesh ? "border-[#ffd3bd]/60" : "border-gray-400/30"
            }`}
          />
        </div>

        {/* Google Login Button */}
        <button
          type="button"
          onClick={onGoogleSignIn}
          className={`w-full flex items-center justify-center py-2.5 px-4 rounded-xl font-semibold border transition-all duration-300 shadow-sm ${
            isSandesh
              ? "bg-white/95 hover:bg-white text-[#1f2937] border-white/80 hover:shadow-md hover:border-[#ffd3bd]"
              : "bg-white/90 hover:bg-white text-gray-700"
          }`}
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 48 48">
            <path
              fill="#FFC107"
              d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 8.841C34.553 4.806 29.613 2.5 24 2.5C11.983 2.5 2.5 11.983 2.5 24s9.483 21.5 21.5 21.5S45.5 36.017 45.5 24c0-1.538-.135-3.022-.389-4.417z"
            />
            <path
              fill="#FF3D00"
              d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12.5 24 12.5c3.059 0 5.842 1.154 7.961 3.039l5.839-5.841C34.553 4.806 29.613 2.5 24 2.5C16.318 2.5 9.642 6.723 6.306 14.691z"
            />
            <path
              fill="#4CAF50"
              d="M24 45.5c5.613 0 10.553-2.306 14.802-6.341l-5.839-5.841C30.842 35.846 27.059 38 24 38c-5.039 0-9.345-2.608-11.124-6.481l-6.571 4.819C9.642 41.277 16.318 45.5 24 45.5z"
            />
            <path
              fill="#1976D2"
              d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l5.839 5.841C44.196 35.123 45.5 29.837 45.5 24c0-1.538-.135-3.022-.389-4.417z"
            />
          </svg>
          Sign in with Google
        </button>
      </form>

      <p
        className={`text-center text-xs ${
          isSandesh ? "text-[#64748b]" : "text-gray-400"
        }`}
      >
        Don't have an account?{" "}
        <a
          href="#"
          className={`font-semibold transition ${
            isSandesh
              ? "text-[#ff7a59] hover:text-[#ff6540]"
              : "text-blue-400 hover:text-blue-300"
          }`}
        >
          Sign Up
        </a>
      </p>
    </div>
  );
}
