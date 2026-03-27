import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function HeroScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 3;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    // Sample geometry
    const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 128, 32);
    const material = new THREE.MeshStandardMaterial({ color: 0x6366f1, wireframe: false });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      mesh.rotation.x += 0.005;
      mesh.rotation.y += 0.01;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ width: '100%', height: '400px' }} />;
}
