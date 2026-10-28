import { Color, ShaderLib, type MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTE } from '@/render/style';
import {
  CHARACTER_PROGRAM_KEY, PALETTE_SIZE, REGION, createCharacterMaterial, patchCharacterShader,
} from './characterMaterial';

/** Kopia kodu shadera z three: `onBeforeCompile` dostaje w przeglądarce dokładnie takie pola. */
function shaderOf(kind: 'standard' | 'physical'): { uniforms: Record<string, { value: Color[] }>; vertexShader: string; fragmentShader: string } {
  return { uniforms: {}, vertexShader: ShaderLib[kind].vertexShader, fragmentShader: ShaderLib[kind].fragmentShader };
}

afterEach(() => vi.restoreAllMocks());

describe('łatka shadera postaci (onBeforeCompile)', () => {
  // `standard` to shader, który kompiluje MeshStandardMaterial; `physical` ma te same chunki i musi znieść łatkę, gdyby materiał się zmienił
  it.each(['standard', 'physical'] as const)('zmienia oba etapy shadera %s i dokłada paletę oraz region, bez błędu', (kind) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = shaderOf(kind);
    const shader = shaderOf(kind);
    createCharacterMaterial([new Color(PALETTE.skin[0])]).onBeforeCompile(shader as never, undefined as never);

    expect(shader.vertexShader).not.toBe(before.vertexShader);
    expect(shader.fragmentShader).not.toBe(before.fragmentShader);
    // vertex: atrybut `region` trafia do varyinga
    expect(shader.vertexShader).toContain('attribute float region;');
    expect(shader.vertexShader).toContain('varying float vRegion;');
    expect(shader.vertexShader).toContain('vRegion = region;');
    // fragment: uniform palety, varying i wybór koloru po regionie (z obciętym od dołu indeksem)
    expect(shader.fragmentShader).toContain(`uniform vec3 uPalette[${PALETTE_SIZE}];`);
    expect(shader.fragmentShader).toContain('varying float vRegion;');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= mix(uPalette[regionIndex]');
    expect(shader.fragmentShader).toContain('int regionIndex = max(int(regionFloor), 0);');
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor');
    // oryginalne chunki zostają: łatka tylko je rozszerza
    for (const chunk of ['color_vertex', 'color_pars_vertex']) expect(shader.vertexShader).toContain(`#include <${chunk}>`);
    for (const chunk of ['color_fragment', 'color_pars_fragment', 'roughnessmap_fragment']) expect(shader.fragmentShader).toContain(`#include <${chunk}>`);
    expect(error).not.toHaveBeenCalled();
  });

  it('gdy shader nie ma chunka do rozszerzenia, loguje błąd z nazwą chunka (łatka nie znika po cichu)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // vertex bez `color_vertex`, fragment bez żadnego z trzech chunków
    const shader = { vertexShader: '#include <color_pars_vertex>\nvoid main() {}', fragmentShader: 'void main() {}' };
    patchCharacterShader(shader);
    const messages = error.mock.calls.map((call) => String(call[0]));
    expect(messages).toHaveLength(4);
    for (const chunk of ['color_vertex', 'color_pars_fragment', 'color_fragment', 'roughnessmap_fragment']) {
      expect(messages.some((m) => m.includes(`#include <${chunk}>`)), chunk).toBe(true);
    }
    expect(messages.some((m) => m.includes('#include <color_pars_vertex>'))).toBe(false);
  });
});

describe('createCharacterMaterial', () => {
  it('uniform uPalette ma zawsze PALETTE_SIZE kolorów (krótka paleta jest dopełniona), a klucz programu jest stały', () => {
    const palette = [new Color(PALETTE.skin[0]), new Color(PALETTE.hair[0])];
    const m: MeshStandardMaterial = createCharacterMaterial(palette);
    const shader = shaderOf('standard');
    m.onBeforeCompile(shader as never, undefined as never);
    const colors = shader.uniforms.uPalette.value;
    expect(colors).toHaveLength(PALETTE_SIZE);
    expect(colors[0].getHex()).toBe(palette[0].getHex());
    expect(colors[1].getHex()).toBe(palette[1].getHex());
    expect(colors[PALETTE_SIZE - 1].getHex()).toBe(palette[0].getHex());
    expect(m.customProgramCacheKey()).toBe(CHARACTER_PROGRAM_KEY);
    expect(m.name).toBe('character');
    expect(REGION.skin).toBeLessThan(PALETTE_SIZE);
  });
});
