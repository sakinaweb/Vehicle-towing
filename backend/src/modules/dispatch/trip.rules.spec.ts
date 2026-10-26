import { BookingStatus as S, InspectionStage, PhotoSlot } from '../../common/enums.js';
import {
  inspectionEditError,
  missingPhotoSlots,
  odometerError,
  tripStepDecision,
} from './trip.rules.js';

describe('tripStepDecision', () => {
  it.each([
    [S.DriverAssigned, 'en-route'],
    [S.DriverArriving, 'arrived'],
    [S.DriverArrived, 'start-tow'],
    [S.InTransit, 'complete'],
  ] as const)('%s → %s applies', (from, step) => {
    expect(tripStepDecision(from, step)).toEqual({ kind: 'apply' });
  });

  it('treats repeating the step just taken as already done (idempotent)', () => {
    expect(tripStepDecision(S.DriverArrived, 'arrived')).toEqual({ kind: 'already-done' });
    expect(tripStepDecision(S.Completed, 'complete')).toEqual({ kind: 'already-done' });
  });

  it('rejects skipping steps with the missing prerequisite', () => {
    expect(tripStepDecision(S.DriverAssigned, 'arrived')).toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('Start driving'),
    });
    expect(tripStepDecision(S.DriverArriving, 'complete')).toMatchObject({
      kind: 'invalid',
      message: 'Start the tow before completing it.',
    });
  });

  it('rejects going backwards and acting on cancelled or unassigned bookings', () => {
    expect(tripStepDecision(S.InTransit, 'arrived')).toMatchObject({
      message: expect.stringContaining('moved past'),
    });
    expect(tripStepDecision(S.Completed, 'start-tow')).toMatchObject({ kind: 'invalid' });
    expect(tripStepDecision(S.Cancelled, 'arrived')).toEqual({
      kind: 'invalid',
      message: 'This job was cancelled.',
    });
    expect(tripStepDecision(S.Searching, 'en-route')).toMatchObject({ kind: 'invalid' });
  });
});

describe('inspection rules', () => {
  it('allows editing only in its own trip stage and only until submitted', () => {
    expect(inspectionEditError(InspectionStage.Pickup, S.DriverArrived, null)).toBeNull();
    expect(inspectionEditError(InspectionStage.Return, S.InTransit, null)).toBeNull();
    expect(inspectionEditError(InspectionStage.Pickup, S.InTransit, null)).toMatch(
      /before starting the tow/,
    );
    expect(inspectionEditError(InspectionStage.Return, S.DriverArrived, null)).toMatch(
      /after starting the tow/,
    );
    expect(inspectionEditError(InspectionStage.Pickup, S.DriverArrived, new Date())).toMatch(
      /already submitted/,
    );
  });

  it('rejects a return odometer below the pickup reading', () => {
    expect(odometerError(InspectionStage.Return, 45_100, 45_120)).toMatch(/cannot be lower/);
    expect(odometerError(InspectionStage.Return, 45_120, 45_120)).toBeNull();
    expect(odometerError(InspectionStage.Pickup, 10, 45_120)).toBeNull();
  });

  it('lists required angles still missing', () => {
    expect(missingPhotoSlots([PhotoSlot.Front, PhotoSlot.Extra, PhotoSlot.Left])).toEqual([
      PhotoSlot.Back,
      PhotoSlot.Right,
    ]);
    expect(
      missingPhotoSlots([PhotoSlot.Right, PhotoSlot.Left, PhotoSlot.Back, PhotoSlot.Front]),
    ).toEqual([]);
  });
});
