import { OrthographicCamera, Scene, type Camera, type Vector2, type WebGLRenderer } from 'three';
import type { Pass } from 'postprocessing';
import { describe, expect, it, vi } from 'vitest';
import { QUALITY, type QualitySettings } from './quality';
import { createPostPipeline, type AoHandle, type EffectsHandle, type PostFactories } from './post';

function fakes(opts: { ao?: () => AoHandle } = {}) {
  const composer = { addPass: vi.fn(), removePass: vi.fn(), render: vi.fn(), setSize: vi.fn(), dispose: vi.fn() };
  const aoSetQuality = vi.fn();
  const aoPass = { name: 'ao', enabled: true, dispose: vi.fn() } as unknown as Pass;
  const effectPasses = [{ name: 'fx1', dispose: vi.fn() }, { name: 'fx2', dispose: vi.fn() }] as unknown as Pass[];
  const setBloomStrength = vi.fn();
  const factories = {
    composer: vi.fn(() => composer),
    ao: vi.fn(opts.ao ?? ((): AoHandle => ({ pass: aoPass, setQuality: aoSetQuality }))),
    effects: vi.fn((_camera: Camera, _q: QualitySettings, _bloom: number): EffectsHandle => ({ passes: effectPasses, setBloomStrength })),
  } satisfies PostFactories;
  const renderer = {
    getDrawingBufferSize: (v: Vector2) => v.set(800, 600),
  } as unknown as WebGLRenderer;
  return { composer, aoPass, aoSetQuality, effectPasses, setBloomStrength, factories, renderer };
}

const scene = new Scene();
const camera = new OrthographicCamera();

describe('createPostPipeline', () => {
  it('składa RenderPass → AO → efekty i renderuje przez composer', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    expect(post.aoAvailable).toBe(true);
    const added = f.composer.addPass.mock.calls.map((c) => c[0]);
    expect(added).toHaveLength(4);
    expect(added[0].constructor.name).toBe('RenderPass');
    expect(added).toContain(f.aoPass);
    expect(f.composer.addPass).toHaveBeenCalledWith(f.aoPass, 1);
    expect(added.slice(-2)).toEqual(f.effectPasses);
    expect(f.aoSetQuality).toHaveBeenCalledWith('half');
    post.render();
    expect(f.composer.render).toHaveBeenCalledTimes(1);
  });

  it('gdy konstruktor AO rzuca, zwraca działający pipeline z aoAvailable === false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakes({ ao: () => { throw new Error('brak WebGL 2 dla AO'); } });
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.wysoka, f.factories);
    expect(post.aoAvailable).toBe(false);
    const added = f.composer.addPass.mock.calls.map((c) => c[0]);
    expect(added).toHaveLength(3); // RenderPass + 2 przebiegi efektów, bez AO
    post.render();
    expect(f.composer.render).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('po nieudanym AO nie ponawia próby przy kolejnych zmianach presetu', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakes({ ao: () => { throw new Error('boom'); } });
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    post.setPreset(QUALITY.wysoka);
    post.setPreset(QUALITY.srednia);
    expect(f.factories.ao).toHaveBeenCalledTimes(1);
    expect(post.aoAvailable).toBe(false);
    warn.mockRestore();
  });

  it('preset niska nie tworzy AO i zostawia aoAvailable === true', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.niska, f.factories);
    expect(f.factories.ao).not.toHaveBeenCalled();
    expect(post.aoAvailable).toBe(true);
  });

  it('setPreset: z niskiej na wysoką tworzy AO w pełnej rozdzielczości, z powrotem na niską zdejmuje je', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.niska, f.factories);
    post.setPreset(QUALITY.wysoka);
    expect(f.factories.ao).toHaveBeenCalledTimes(1);
    expect(f.aoSetQuality).toHaveBeenLastCalledWith('full');
    post.setPreset(QUALITY.srednia);
    expect(f.factories.ao).toHaveBeenCalledTimes(1);
    expect(f.aoSetQuality).toHaveBeenLastCalledWith('half');
    post.setPreset(QUALITY.niska);
    expect(f.composer.removePass).toHaveBeenCalledWith(f.aoPass);
  });

  it('setPreset przebudowuje przebiegi efektów z nowymi ustawieniami jakości', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    post.setPreset(QUALITY.niska);
    expect(f.factories.effects).toHaveBeenCalledTimes(2);
    expect(f.factories.effects.mock.calls[1][1]).toBe(QUALITY.niska);
    for (const p of f.effectPasses) expect(f.composer.removePass).toHaveBeenCalledWith(p);
  });

  it('setPreset bez zmiany bloomu i SMAA nie przebudowuje efektów', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    post.setPreset(QUALITY.wysoka);
    expect(f.factories.effects).toHaveBeenCalledTimes(1);
  });

  it('setBloomStrength dociera do efektów i przeżywa przebudowę', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    post.setBloomStrength(0.9);
    expect(f.setBloomStrength).toHaveBeenCalledWith(0.9);
    post.setPreset(QUALITY.niska);
    expect(f.factories.effects.mock.calls[1][2]).toBe(0.9);
  });

  it('setSize przekazuje rozmiar do composera', () => {
    const f = fakes();
    const post = createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories);
    post.setSize(1280, 720);
    expect(f.composer.setSize).toHaveBeenCalledWith(1280, 720, true);
  });

  it('błąd tworzenia composera propaga się do wywołującego (renderer przechodzi wtedy na tryb bez postprocessingu)', () => {
    const f = fakes();
    f.factories.composer.mockImplementation(() => { throw new Error('brak buforów zmiennoprzecinkowych'); });
    expect(() => createPostPipeline(f.renderer, scene, camera, QUALITY.srednia, f.factories)).toThrow('brak buforów');
  });
});
