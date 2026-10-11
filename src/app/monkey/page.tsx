"use client";

import React, { useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function MonkeyPhysicsPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const leftBallRef = useRef<SVGCircleElement>(null);
  const rightBallRef = useRef<SVGCircleElement>(null);

  // Store physics state in a ref to avoid React re-renders during the animation loop
  const physics = useRef({
    leftBall: { x: -12, y: 55, vx: 0, vy: 0, originX: -12, originY: 55 },
    rightBall: { x: 12, y: 55, vx: 0, vy: 0, originX: 12, originY: 55 },
    mouseX: 9999,
    mouseY: 9999,
  });

  useEffect(() => {
    let animationFrameId: number;
    
    // Physics tuning
    const k = 0.15; // Spring stiffness (pulls them back into place)
    const damp = 0.85; // Damping (makes them eventually stop swinging)
    const repelForce = 350; // How hard the cursor pushes them away
    const interactRadius = 45; // Cursor interaction distance

    const update = () => {
      const { leftBall, rightBall, mouseX, mouseY } = physics.current;
      const balls = [leftBall, rightBall];
      const refs = [leftBallRef.current, rightBallRef.current];

      balls.forEach((ball, i) => {
        // 1. Spring force pulling back to origin
        const fx = (ball.originX - ball.x) * k;
        const fy = (ball.originY - ball.y) * k;

        // 2. Repulsion force from mouse
        const dx = ball.x - mouseX;
        const dy = ball.y - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        let mx = 0;
        let my = 0;

        if (dist < interactRadius) {
          // The closer the mouse, the stronger the push
          const force = (repelForce * (1 - dist / interactRadius)) / dist;
          mx = dx * force;
          my = dy * force;
        }

        // 3. Apply forces to velocity, then dampen
        ball.vx = (ball.vx + fx + mx) * damp;
        ball.vy = (ball.vy + fy + my) * damp;

        // 4. Update position
        ball.x += ball.vx;
        ball.y += ball.vy;

        // 5. Direct DOM manipulation for maximum 60fps performance
        if (refs[i]) {
          refs[i]!.setAttribute("cx", ball.x.toString());
          refs[i]!.setAttribute("cy", ball.y.toString());
        }
      });

      animationFrameId = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const svgWidth = 200; // viewBox width
    const svgHeight = 200; // viewBox height
    
    // Calculate the actual rendered scale of the SVG to perfectly map cursor
    const scale = Math.min(rect.width / svgWidth, rect.height / svgHeight);
    const offsetX = (rect.width - svgWidth * scale) / 2;
    const offsetY = (rect.height - svgHeight * scale) / 2;

    // Convert pixel coordinates to SVG viewBox coordinates
    const svgX = (e.clientX - rect.left - offsetX) / scale - 100;
    const svgY = (e.clientY - rect.top - offsetY) / scale - 100;

    physics.current.mouseX = svgX;
    physics.current.mouseY = svgY;
  };

  const handleMouseLeave = () => {
    // Move mouse out of range when leaving the SVG
    physics.current.mouseX = 9999;
    physics.current.mouseY = 9999;
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl bg-white shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-neutral-800">Interactive Monkey Physics</CardTitle>
          <CardDescription className="text-neutral-500">
            Move your cursor near the monkey's nether regions to trigger the spring physics simulation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full aspect-square max-h-[600px] mx-auto bg-sky-100 rounded-xl border border-neutral-200 overflow-hidden shadow-inner cursor-crosshair">
            <svg
              ref={svgRef}
              viewBox="-100 -100 200 200"
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchMove={(e) => {
                // Map touch events to mouse equivalent for mobile testing
                const touch = e.touches[0];
                handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY } as React.MouseEvent);
              }}
              onTouchEnd={handleMouseLeave}
            >
              {/* --- BACKGROUND JUNGLE VIBES --- */}
              <path d="M-100 100 L-50 20 L0 100 Z" fill="#bbf7d0" opacity="0.6" />
              <path d="M0 100 L50 -10 L100 100 Z" fill="#86efac" opacity="0.6" />

              {/* --- MONKEY TAIL --- */}
              <path
                d="M 10 30 Q 80 80 70 0 Q 60 -30 80 -40"
                fill="none"
                stroke="#5c4033"
                strokeWidth="8"
                strokeLinecap="round"
              />

              {/* --- BACK LEGS --- */}
              <line x1="-25" y1="30" x2="-45" y2="85" stroke="#5c4033" strokeWidth="12" strokeLinecap="round" />
              <line x1="25" y1="30" x2="45" y2="85" stroke="#5c4033" strokeWidth="12" strokeLinecap="round" />
              
              {/* Back feet */}
              <ellipse cx="-48" cy="85" rx="8" ry="5" fill="#3e2a22" />
              <ellipse cx="48" cy="85" rx="8" ry="5" fill="#3e2a22" />

              {/* --- BODY --- */}
              <ellipse cx="0" cy="15" rx="35" ry="45" fill="#8b5a2b" />
              <ellipse cx="0" cy="20" rx="25" ry="35" fill="#d2b48c" /> {/* Belly */}

              {/* --- THE BALLS (Physics Targets) --- */}
              <g stroke="#3e2a22" strokeWidth="1.5">
                <circle
                  ref={leftBallRef}
                  cx="-12"
                  cy="55"
                  r="12"
                  fill="#e5c8a8"
                  className="transition-colors duration-200"
                />
                <circle
                  ref={rightBallRef}
                  cx="12"
                  cy="55"
                  r="12"
                  fill="#e5c8a8"
                  className="transition-colors duration-200"
                />
              </g>

              {/* --- ARMS --- */}
              <path
                d="M -30 -5 Q -60 10 -50 50"
                fill="none"
                stroke="#5c4033"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                d="M 30 -5 Q 60 10 50 50"
                fill="none"
                stroke="#5c4033"
                strokeWidth="11"
                strokeLinecap="round"
              />
              
              {/* Hands */}
              <circle cx="-50" cy="50" r="7" fill="#d2b48c" />
              <circle cx="50" cy="50" r="7" fill="#d2b48c" />

              {/* --- HEAD --- */}
              {/* Ears */}
              <circle cx="-40" cy="-45" r="14" fill="#d2b48c" stroke="#8b5a2b" strokeWidth="4" />
              <circle cx="40" cy="-45" r="14" fill="#d2b48c" stroke="#8b5a2b" strokeWidth="4" />
              
              {/* Skull */}
              <circle cx="0" cy="-45" r="32" fill="#8b5a2b" />
              
              {/* Face Mask (Heart-ish shape) */}
              <path
                d="M 0 -35 
                   C -25 -65, -40 -35, -20 -15 
                   C -10 -5, 10 -5, 20 -15 
                   C 40 -35, 25 -65, 0 -35 Z"
                fill="#d2b48c"
              />
              
              {/* Eyes */}
              <circle cx="-12" cy="-42" r="5" fill="#fff" />
              <circle cx="-12" cy="-42" r="2.5" fill="#000" />
              
              <circle cx="12" cy="-42" r="5" fill="#fff" />
              <circle cx="12" cy="-42" r="2.5" fill="#000" />
              
              {/* Nose */}
              <ellipse cx="0" cy="-28" rx="4" ry="2.5" fill="#3e2a22" />
              
              {/* Smile */}
              <path d="M -12 -20 Q 0 -10 12 -20" fill="none" stroke="#3e2a22" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}