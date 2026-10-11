"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

// Inline UI components mimicking Shadcn for zero-dependency single-file deployment
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const Label = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <label className={`text-xs font-semibold text-neutral-400 uppercase tracking-wider ${className}`}>
    {children}
  </label>
);

const Slider = ({ value, min, max, step, onChange, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }) => (
  <div className="space-y-2 mb-4">
    <div className="flex justify-between">
      <Label>{label}</Label>
      <span className="text-xs text-sky-400 font-mono">{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-sky-500 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
    />
  </div>
);

export default function OverEngineeredMonkeyPhysics() {
  // SVG Elements
  const svgRef = useRef<SVGSVGElement>(null);
  const leftBallRef = useRef<SVGCircleElement>(null);
  const rightBallRef = useRef<SVGCircleElement>(null);
  const leftStringRef = useRef<SVGLineElement>(null);
  const rightStringRef = useRef<SVGLineElement>(null);
  const interactionFieldRef = useRef<SVGCircleElement>(null);

  // Telemetry DOM elements (updating React state at 60fps destroys performance, using direct DOM mutation)
  const fpsRef = useRef<HTMLSpanElement>(null);
  const vel1Ref = useRef<HTMLSpanElement>(null);
  const vel2Ref = useRef<HTMLSpanElement>(null);
  const keRef = useRef<HTMLSpanElement>(null);
  const stressRef = useRef<HTMLDivElement>(null);

  // Simulation parameters (controlled via UI)
  const [params, setParams] = useState({
    gravity: 0.15,
    damping: 0.985,
    stiffness: 0.08,
    stringLength: 35,
    repelForce: 2.5,
    repelRadius: 60,
    ballRadius: 12,
    bounce: 0.85,
  });

  // Use a ref for params to avoid closure staleness in the animation loop
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Core physics state engine
  const engine = useRef({
    mouse: { x: -999, y: -999, active: false },
    anchor: { x: 0, y: 25 },
    ball1: { x: -15, y: 60, vx: 0, vy: 0 },
    ball2: { x: 15, y: 60, vx: 0, vy: 0 },
    lastFrameTime: typeof window !== "undefined" ? performance.now() : 0,
    frameCount: 0,
    lastFpsUpdate: 0,
  });

  useEffect(() => {
    let animationFrameId: number;

    const tick = (now: number) => {
      const state = engine.current;
      const p = paramsRef.current;
      
      // Calculate delta time (clamped to prevent explosion on tab switch)
      const dt = Math.min((now - state.lastFrameTime) / 16.66, 3);
      state.lastFrameTime = now;

      // FPS Calculation (update every 500ms)
      state.frameCount++;
      if (now - state.lastFpsUpdate > 500) {
        if (fpsRef.current) fpsRef.current.innerText = `${Math.round((state.frameCount * 1000) / (now - state.lastFpsUpdate))} FPS`;
        state.frameCount = 0;
        state.lastFpsUpdate = now;
      }

      const { ball1, ball2, anchor, mouse } = state;
      const balls = [ball1, ball2];
      let totalKineticEnergy = 0;
      let maxStress = 0;

      // 1. Integration & Forces
      balls.forEach((ball) => {
        // Gravity
        ball.vy += p.gravity * dt;

        // Mouse Repulsion Field (Inverse Square-ish)
        if (mouse.active) {
          const dxMouse = ball.x - mouse.x;
          const dyMouse = ball.y - mouse.y;
          const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse) || 1;
          
          if (distMouse < p.repelRadius) {
            const force = (p.repelRadius - distMouse) / p.repelRadius * p.repelForce;
            ball.vx += (dxMouse / distMouse) * force * dt;
            ball.vy += (dyMouse / distMouse) * force * dt;
          }
        }

        // Spring Mechanics (Hooke's Law approximation)
        const dxAnchor = anchor.x - ball.x;
        const dyAnchor = anchor.y - ball.y;
        const distAnchor = Math.sqrt(dxAnchor * dxAnchor + dyAnchor * dyAnchor) || 1;
        const stretch = distAnchor - p.stringLength;
        
        // Track stress for telemetry
        maxStress = Math.max(maxStress, stretch);

        const springForce = stretch * p.stiffness;
        ball.vx += (dxAnchor / distAnchor) * springForce * dt;
        ball.vy += (dyAnchor / distAnchor) * springForce * dt;

        // Apply velocity and damping
        ball.vx *= Math.pow(p.damping, dt);
        ball.vy *= Math.pow(p.damping, dt);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Calculate KE (1/2 m v^2, assuming m=1)
        totalKineticEnergy += 0.5 * (ball.vx * ball.vx + ball.vy * ball.vy);
      });

      // 2. Resolve Collisions (Elastic Body)
      const dxBalls = ball2.x - ball1.x;
      const dyBalls = ball2.y - ball1.y;
      const distBalls = Math.sqrt(dxBalls * dxBalls + dyBalls * dyBalls) || 1;
      const minDist = p.ballRadius * 2;

      if (distBalls < minDist) {
        // Positional correction (prevent sinking)
        const overlap = minDist - distBalls;
        const nx = dxBalls / distBalls;
        const ny = dyBalls / distBalls;

        ball1.x -= nx * overlap * 0.5;
        ball1.y -= ny * overlap * 0.5;
        ball2.x += nx * overlap * 0.5;
        ball2.y += ny * overlap * 0.5;

        // Momentum conservation
        const rvx = ball2.vx - ball1.vx;
        const rvy = ball2.vy - ball1.vy;
        const speed = rvx * nx + rvy * ny;

        if (speed < 0) {
          const impulse = -(1 + p.bounce) * speed * 0.5;
          ball1.vx -= nx * impulse;
          ball1.vy -= ny * impulse;
          ball2.vx += nx * impulse;
          ball2.vy += ny * impulse;
        }
      }

      // 3. High-Performance DOM Updates (Bypass React)
      if (leftBallRef.current && rightBallRef.current && leftStringRef.current && rightStringRef.current) {
        leftBallRef.current.setAttribute("cx", ball1.x.toFixed(2));
        leftBallRef.current.setAttribute("cy", ball1.y.toFixed(2));
        rightBallRef.current.setAttribute("cx", ball2.x.toFixed(2));
        rightBallRef.current.setAttribute("cy", ball2.y.toFixed(2));

        leftStringRef.current.setAttribute("x2", ball1.x.toFixed(2));
        leftStringRef.current.setAttribute("y2", ball1.y.toFixed(2));
        rightStringRef.current.setAttribute("x2", ball2.x.toFixed(2));
        rightStringRef.current.setAttribute("y2", ball2.y.toFixed(2));
      }

      if (interactionFieldRef.current) {
        if (mouse.active) {
          interactionFieldRef.current.setAttribute("cx", mouse.x.toFixed(2));
          interactionFieldRef.current.setAttribute("cy", mouse.y.toFixed(2));
          interactionFieldRef.current.setAttribute("r", p.repelRadius.toString());
          interactionFieldRef.current.setAttribute("opacity", "0.15");
        } else {
          interactionFieldRef.current.setAttribute("opacity", "0");
        }
      }

      // 4. Update Telemetry
      if (vel1Ref.current) vel1Ref.current.innerText = Math.sqrt(ball1.vx**2 + ball1.vy**2).toFixed(2);
      if (vel2Ref.current) vel2Ref.current.innerText = Math.sqrt(ball2.vx**2 + ball2.vy**2).toFixed(2);
      if (keRef.current) keRef.current.innerText = totalKineticEnergy.toFixed(2);
      if (stressRef.current) {
        const stressPercent = Math.min((Math.max(0, maxStress) / 20) * 100, 100);
        stressRef.current.style.width = `${stressPercent}%`;
        stressRef.current.style.backgroundColor = stressPercent > 80 ? '#ef4444' : stressPercent > 50 ? '#f59e0b' : '#3b82f6';
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Map screen coordinates to SVG ViewBox [-100, -100] to [100, 100]
  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    
    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const scale = Math.min(rect.width / 200, rect.height / 200);
    const offsetX = (rect.width - 200 * scale) / 2;
    const offsetY = (rect.height - 200 * scale) / 2;

    const svgX = (clientX - rect.left - offsetX) / scale - 100;
    const svgY = (clientY - rect.top - offsetY) / scale - 100;

    engine.current.mouse = { x: svgX, y: svgY, active: true };
  }, []);

  const handlePointerLeave = useCallback(() => {
    engine.current.mouse.active = false;
  }, []);

  return (
    <div className="min-h-screen bg-black text-neutral-200 font-sans p-4 lg:p-8 flex flex-col items-center justify-center">
      
      {/* Header */}
      <div className="w-full max-w-7xl mb-6 flex justify-between items-end border-b border-neutral-800 pb-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            MONKEY PHYSICS SOLVER 
            <span className="text-[10px] uppercase tracking-widest bg-sky-500/10 text-sky-400 px-2 py-1 rounded-sm border border-sky-500/20">
              v2.0 Over-Engineered
            </span>
          </h1>
          <p className="text-sm text-neutral-500 mt-1 font-mono">Verlet Integration | AABB Collision | Hooke's Law</p>
        </div>
        <div className="text-right hidden md:block">
          <div className="flex items-center gap-2 justify-end mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span ref={fpsRef} className="font-mono text-emerald-400 text-sm font-bold">60 FPS</span>
          </div>
          <p className="text-xs text-neutral-500 font-mono">System Active</p>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
        
        {/* Left Sidebar: Controls */}
        <Card className="lg:col-span-3 p-5 flex flex-col h-full bg-neutral-900/50 backdrop-blur-xl">
          <h2 className="text-sm font-bold text-white mb-6 flex items-center gap-2 border-b border-neutral-800 pb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M12 2v2"/><path d="M12 22v-2"/><path d="m17 20.66-1-1.73"/><path d="M11 10.27 7 3.34"/><path d="m20.66 17-1.73-1"/><path d="m3.34 7 1.73 1"/><path d="M14 12h8"/><path d="M2 12h2"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m17 3.34-1 1.73"/><path d="m11 13.73-4 6.93"/></svg>
            DYNAMICS CONTROL
          </h2>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-6 scrollbar-thin scrollbar-thumb-neutral-700">
            <Slider label="Gravity Constraint" min={0} max={1} step={0.01} value={params.gravity} onChange={(v) => setParams({ ...params, gravity: v })} />
            <Slider label="Spring Stiffness (k)" min={0.01} max={0.3} step={0.01} value={params.stiffness} onChange={(v) => setParams({ ...params, stiffness: v })} />
            <Slider label="Air Resistance (Damping)" min={0.9} max={1} step={0.001} value={params.damping} onChange={(v) => setParams({ ...params, damping: v })} />
            <Slider label="Repulsion Force" min={0} max={10} step={0.1} value={params.repelForce} onChange={(v) => setParams({ ...params, repelForce: v })} />
            <Slider label="Interaction Radius" min={20} max={100} step={1} value={params.repelRadius} onChange={(v) => setParams({ ...params, repelRadius: v })} />
            <Slider label="Tendon Length" min={10} max={80} step={1} value={params.stringLength} onChange={(v) => setParams({ ...params, stringLength: v })} />
          </div>
        </Card>

        {/* Center: Main Viewport */}
        <Card className="lg:col-span-6 relative flex items-center justify-center p-0 bg-[#0a192f] border-neutral-700 aspect-square lg:aspect-auto overflow-hidden group">
          {/* Diagnostic Overlay Grid */}
          <div className="absolute inset-0 pointer-events-none opacity-20" 
               style={{ backgroundImage: 'linear-gradient(#30363d 1px, transparent 1px), linear-gradient(90deg, #30363d 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          </div>
          
          {/* Center Crosshair */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
             <div className="w-full h-[1px] bg-sky-500"></div>
             <div className="h-full w-[1px] bg-sky-500 absolute"></div>
          </div>

          <svg
            ref={svgRef}
            viewBox="-100 -100 200 200"
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full relative z-10 cursor-crosshair touch-none"
            onMouseMove={handlePointerMove}
            onMouseLeave={handlePointerLeave}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerLeave}
          >
            <defs>
              {/* Jungle Gradients */}
              <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0d2b1f" />
                <stop offset="100%" stopColor="#1a4731" />
              </linearGradient>
              <radialGradient id="ballGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#e5c8a8" />
                <stop offset="80%" stopColor="#b38b60" />
                <stop offset="100%" stopColor="#5c4033" />
              </radialGradient>
            </defs>

            {/* Background Environment */}
            <rect x="-100" y="-100" width="200" height="200" fill="url(#bgGrad)" />
            <path d="M-100 100 Q -50 0 0 100 Q 50 20 100 100" fill="#0a1f16" opacity="0.8" />
            <path d="M-100 100 L -70 40 L -40 100 Z M 40 100 L 70 30 L 100 100 Z" fill="#133624" />
            
            {/* Hanging Vines */}
            <path d="M -80 -100 Q -60 -50 -70 0" fill="none" stroke="#2a4d33" strokeWidth="2" />
            <path d="M 80 -100 Q 60 -50 90 20" fill="none" stroke="#2a4d33" strokeWidth="3" />

            {/* Repulsion Interaction Field Indicator */}
            <circle ref={interactionFieldRef} cx="0" cy="0" r="0" fill="#38bdf8" opacity="0" className="transition-opacity duration-300" />

            {/* --- MONKEY RIG --- */}
            <g id="monkey-body">
              {/* Tail */}
              <path d="M 0 0 Q 80 50 70 -30 Q 55 -60 70 -70" fill="none" stroke="#5c4033" strokeWidth="8" strokeLinecap="round" />
              {/* Back Legs */}
              <line x1="-20" y1="20" x2="-35" y2="60" stroke="#5c4033" strokeWidth="10" strokeLinecap="round" />
              <line x1="20" y1="20" x2="35" y2="60" stroke="#5c4033" strokeWidth="10" strokeLinecap="round" />
              
              {/* Body */}
              <ellipse cx="0" cy="-5" rx="30" ry="40" fill="#8b5a2b" />
              <ellipse cx="0" cy="0" rx="22" ry="32" fill="#d2b48c" /> {/* Belly */}

              {/* Arms hugging the anchor point */}
              <path d="M -25 -25 Q -40 10 -10 25" fill="none" stroke="#5c4033" strokeWidth="9" strokeLinecap="round" />
              <path d="M 25 -25 Q 40 10 10 25" fill="none" stroke="#5c4033" strokeWidth="9" strokeLinecap="round" />

              {/* Head */}
              <circle cx="-35" cy="-55" r="12" fill="#d2b48c" stroke="#8b5a2b" strokeWidth="3" /> {/* L Ear */}
              <circle cx="35" cy="-55" r="12" fill="#d2b48c" stroke="#8b5a2b" strokeWidth="3" /> {/* R Ear */}
              <circle cx="0" cy="-55" r="30" fill="#8b5a2b" /> {/* Skull */}
              
              {/* Face */}
              <path d="M 0 -45 C -25 -75, -35 -45, -15 -25 C -5 -15, 5 -15, 15 -25 C 35 -45, 25 -75, 0 -45 Z" fill="#d2b48c" />
              
              {/* Surprised/Focused Expression */}
              <circle cx="-12" cy="-52" r="6" fill="#fff" />
              <circle cx="-12" cy="-52" r="2.5" fill="#000" />
              <circle cx="12" cy="-52" r="6" fill="#fff" />
              <circle cx="12" cy="-52" r="2.5" fill="#000" />
              <ellipse cx="0" cy="-38" rx="4" ry="2.5" fill="#3e2a22" />
              <ellipse cx="0" cy="-25" rx="6" ry="8" fill="#5c4033" /> {/* Open mouth */}
            </g>

            {/* Anchor Point HUD */}
            <circle cx="0" cy="25" r="3" fill="#ef4444" className="animate-pulse" />
            <path d="M -10 25 L -4 25 M 10 25 L 4 25 M 0 15 L 0 21 M 0 35 L 0 29" stroke="#ef4444" strokeWidth="1" />

            {/* Physics Connectors (Springs) */}
            <line ref={leftStringRef} x1="0" y1="25" stroke="#9ca3af" strokeWidth="3" strokeDasharray="4 2" strokeLinecap="round" />
            <line ref={rightStringRef} x1="0" y1="25" stroke="#9ca3af" strokeWidth="3" strokeDasharray="4 2" strokeLinecap="round" />

            {/* Physics Rigid Bodies */}
            <circle ref={leftBallRef} r={params.ballRadius} fill="url(#ballGlow)" stroke="#3e2a22" strokeWidth="1.5" />
            <circle ref={rightBallRef} r={params.ballRadius} fill="url(#ballGlow)" stroke="#3e2a22" strokeWidth="1.5" />
          </svg>

          {/* Diagnostic Overlay Labels */}
          <div className="absolute bottom-4 left-4 pointer-events-none bg-black/60 px-3 py-2 rounded-md border border-neutral-700 backdrop-blur-sm">
             <div className="text-[10px] text-sky-400 font-mono tracking-widest mb-1">ENGINE STATUS</div>
             <div className="text-xs text-neutral-300 font-mono">Render: SVG Hardware Accel</div>
             <div className="text-xs text-neutral-300 font-mono">Tick: requestAnimationFrame</div>
          </div>
        </Card>

        {/* Right Sidebar: Telemetry */}
        <Card className="lg:col-span-3 p-5 flex flex-col h-full bg-neutral-900/50 backdrop-blur-xl">
          <h2 className="text-sm font-bold text-white mb-6 flex items-center gap-2 border-b border-neutral-800 pb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            REAL-TIME TELEMETRY
          </h2>

          <div className="space-y-6">
            
            {/* Dynamic Metric: Velocity */}
            <div className="bg-black/50 p-4 rounded-lg border border-neutral-800">
              <Label className="block mb-2">Mass 1 Velocity (u/s)</Label>
              <div className="text-3xl font-mono font-light text-sky-400 flex items-baseline gap-1">
                <span ref={vel1Ref}>0.00</span>
                <span className="text-sm text-neutral-600">v</span>
              </div>
            </div>

            <div className="bg-black/50 p-4 rounded-lg border border-neutral-800">
              <Label className="block mb-2">Mass 2 Velocity (u/s)</Label>
              <div className="text-3xl font-mono font-light text-sky-400 flex items-baseline gap-1">
                <span ref={vel2Ref}>0.00</span>
                <span className="text-sm text-neutral-600">v</span>
              </div>
            </div>

            {/* Dynamic Metric: Kinetic Energy */}
            <div className="bg-black/50 p-4 rounded-lg border border-neutral-800">
              <Label className="block mb-2 text-purple-400">Total Kinetic Energy (J)</Label>
              <div className="text-2xl font-mono font-light text-purple-300">
                <span ref={keRef}>0.00</span>
              </div>
              <div className="mt-2 h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 w-1/3 animate-pulse opacity-50" />
              </div>
            </div>

            {/* Dynamic Metric: Tension Stress */}
            <div className="bg-black/50 p-4 rounded-lg border border-neutral-800">
              <div className="flex justify-between items-center mb-2">
                <Label className="text-orange-400">Tension Stress Level</Label>
                <div className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
              </div>
              <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden mt-3 relative">
                {/* Visual Stress Bar updated via DOM */}
                <div ref={stressRef} className="absolute left-0 top-0 h-full bg-blue-500 w-0 transition-all duration-75" />
              </div>
              <div className="flex justify-between mt-1 text-[9px] font-mono text-neutral-500">
                <span>RELAXED</span>
                <span>YIELD POINT</span>
              </div>
            </div>
            
            {/* System Logs (Static Mockup) */}
            <div className="mt-auto">
              <Label className="mb-2 block">Solver Logs</Label>
              <div className="font-mono text-[10px] text-neutral-500 space-y-1 h-24 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/50 to-transparent z-10" />
                <p className="text-emerald-500/50">[OK] Physics engine initialized</p>
                <p>[AABB] Collision grid mapped</p>
                <p>[HOOKES] Spring anchors verified</p>
                <p>[INTEGRATOR] Verlet solver active</p>
                <p className="text-sky-500/50">[LISTENER] Pointer events bound</p>
              </div>
            </div>

          </div>
        </Card>

      </div>
    </div>
  );
}