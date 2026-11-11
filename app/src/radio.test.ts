import { describe, expect, it } from 'vitest';
import { makeTestMap } from '../../world/src/test-map.ts';
import { readRadio, readTransmission, transmissions } from './radio.ts';

const map = makeTestMap();
const read = (t: string) => readTransmission(t, map);

describe('radio traffic', () => {
  it('cuts a transcript into transmissions and drops the acknowledgements', () => {
    expect(
      transmissions(
        'Unit 12 to command, heavy crowd at gate 2, over. Copy that. 10-4. Command, unit 7, we need medics at gate 3.',
      ),
    ).toEqual(['Unit 12 to command, heavy crowd at gate 2,', 'Command, unit 7, we need medics at gate 3.']);
  });

  it('reads who is talking, what it is and where', () => {
    expect(read('Unit 12 to command, the crowd is backing up bad at gate two, requesting 3 more units')).toMatchObject({
      unit: 'Unit 12',
      kind: 'crowd crush',
      place: { label: 'Gate 2' },
      summary: 'Unit 12: crowd crush at Gate 2',
      suggestion: 'send 3 officers to Gate 2',
    });
    expect(read('Command, car 4, we have a fight at gate 3')).toMatchObject({
      unit: 'Car 4',
      kind: 'fight',
      suggestion: 'send 2 officers to Gate 3',
    });
    expect(read('OSU PD 5 requesting backup at the north concourse')).toMatchObject({
      unit: 'OSU PD 5',
      kind: 'backup',
      place: { label: 'North concourse' },
    });
  });

  it('does not take the unit number for a gate or a head count', () => {
    const r = read('Unit 3 requesting backup at gate 1');
    expect(r.place?.label).toBe('Gate 1');
    expect(r.suggestion).toBe('send 2 officers to Gate 1');
  });

  it('suggests officers for a medical or traffic call only when they are asked for', () => {
    expect(read('Unit 9, fan down at gate 1, unconscious, EMS is on the way').suggestion).toBeNull();
    expect(read('Unit 9, fan down at gate 1, need two officers for crowd control')).toMatchObject({
      kind: 'medical',
      suggestion: 'send 2 officers to Gate 1',
    });
    expect(read('Unit 6, stalled vehicle blocking plaza lane')).toMatchObject({
      kind: 'traffic',
      street: true,
      summary: 'Unit 6: traffic on Plaza lane',
      suggestion: null,
    });
  });

  it('knows an all clear, and suggests nothing for it', () => {
    expect(read('Unit 12, gate 2 is under control, cancel the backup')).toMatchObject({
      kind: 'all clear',
      place: { label: 'Gate 2' },
      suggestion: null,
    });
  });

  it('keeps what it cannot place as heard, with no suggestion', () => {
    expect(read('Unit 2, requesting backup at the loading dock')).toMatchObject({
      kind: 'backup',
      place: null,
      suggestion: null,
      summary: 'Unit 2: backup',
    });
    expect(read('Be advised the halftime show is running long')).toMatchObject({
      unit: null,
      kind: 'other',
      suggestion: null,
      summary: 'report',
    });
  });

  it('copes with what speech-to-text does to radio traffic', () => {
    // The call split off as its own sentence, an acknowledgement, a misspelt street, "backup" misheard.
    const reports = readRadio(
      'Unit 12 to Command. The crowd is backing up at Gate 2, requesting 3 more units, over.\n Command copies, Unit 12.\n Command, Car 4. A stalled vehicle is blocking Plaza Lain.\n Command, Unit 9, there is a 5 at Gate 3, send back off.',
      map,
    );
    expect(reports.map((r) => r.summary)).toEqual([
      'Unit 12: crowd crush at Gate 2',
      'Car 4: traffic on Plaza lane',
      'Unit 9: backup at Gate 3',
    ]);
    expect(reports.map((r) => r.suggestion)).toEqual(['send 3 officers to Gate 2', null, 'send 2 officers to Gate 3']);
  });

  it("does not find this map in somebody else's radio traffic", () => {
    // One letter off a name is not enough by itself, and recogniser marks are not speech.
    expect(read('The address we are going to is 909 Plazo').place).toBeNull();
    expect(transmissions('[ Silence ] >> Copy, thank you. >> 125, your case number is 2389.')).toEqual([
      '125, your case number is 2389.',
    ]);
  });

  it('reads a whole transcript', () => {
    const reports = readRadio(
      'Unit 12, unattended backpack by gate 3. Copy. Unit 7, shoving in the line at gate 2, send help, over.',
      map,
    );
    expect(reports.map((r) => r.summary)).toEqual([
      'Unit 12: suspicious item at Gate 3',
      'Unit 7: crowd crush at Gate 2',
    ]);
    expect(reports.map((r) => r.suggestion)).toEqual([null, 'send 2 officers to Gate 2']);
  });
});
