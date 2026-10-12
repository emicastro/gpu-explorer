import { describe, expect, it } from 'vitest';
import { createMaterials, KIND_LOOKS } from './materials.ts';
import { PART_KINDS } from './palette.ts';
import { buildField, encodeField } from './textures.ts';

describe('materials', () => {
  it('gives every PartKind a material, enabled, disabled and instanced', () => {
    const set = createMaterials({ fades: false });
    for (const kind of PART_KINDS) {
      expect(KIND_LOOKS[kind]).toBeDefined();
      expect(set.part(kind, true)).toBeDefined();
      expect(set.part(kind, false)).not.toBe(set.part(kind, true));
      expect(set.instanced(kind)).toBeDefined();
    }
    set.dispose();
  });

  it('shares one material per kind and state within a set', () => {
    const set = createMaterials({ fades: false });
    expect(set.part('hbm', true)).toBe(set.part('hbm', true));
    set.dispose();
  });

  it('keeps the palette color and dims disabled parts', () => {
    const set = createMaterials({ fades: false });
    const on = set.part('gpc', true).color.getHex();
    const off = set.part('gpc', false).color.getHex();
    expect(off).not.toBe(on);
    expect(set.part('gpc', false).envMapIntensity).toBeLessThan(set.part('gpc', true).envMapIntensity);
    set.dispose();
  });

  it('makes metal parts metallic and the substrate not', () => {
    const set = createMaterials({ fades: false });
    expect(set.part('hbm', true).metalness).toBe(1);
    expect(set.part('stiffener', true).metalness).toBe(1);
    expect(set.part('substrate', true).metalness).toBe(0);
    set.dispose();
  });

  it('fading one group does not change the opacity of another group\'s materials', () => {
    const fading = createMaterials({ fades: true });
    const other = createMaterials({ fades: false });
    const kinds = ['interposer', 'hbm', 'substrate'] as const;
    for (const k of kinds) {
      fading.part(k, true);
      other.part(k, true);
    }
    fading.setOpacity(0.25);
    expect(fading.all().every((m) => m.opacity === 0.25 && m.transparent)).toBe(true);
    expect(other.all().every((m) => m.opacity === 1 && !m.transparent)).toBe(true);
    // A material built after the fade starts at the set's current opacity.
    expect(fading.part('die', true).opacity).toBe(0.25);
    expect(() => { other.setOpacity(0.5); }).toThrow();
    fading.dispose();
    other.dispose();
  });
});

describe('surface textures', () => {
  it('stay within 1024² and tile', () => {
    for (const detail of ['traces', 'bumps', 'grain'] as const) {
      const f = buildField(detail);
      expect(f.size).toBeLessThanOrEqual(1024);
      expect(Math.log2(f.size) % 1).toBe(0);
      const { normal, rough } = encodeField(f, 2);
      expect(normal).toHaveLength(f.size * f.size * 4);
      expect(rough).toHaveLength(f.size * f.size * 4);
    }
  });

  it('are deterministic', () => {
    expect(buildField('grain').height).toEqual(buildField('grain').height);
  });
});
