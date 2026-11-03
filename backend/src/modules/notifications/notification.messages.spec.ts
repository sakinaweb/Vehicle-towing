import { messageFor } from './notification.messages.js';

describe('messageFor: chat and SOS', () => {
  it('pushes chat to the recipient only, with a short preview', () => {
    const msg = { id: 'm1', bookingId: 'b1', senderRole: 'driver', body: 'x'.repeat(200) };
    expect(messageFor('chat:message', { ...msg, mine: true })).toBeNull();
    const push = messageFor('chat:message', { ...msg, mine: false })!;
    expect(push).toMatchObject({
      type: 'chat.message',
      title: 'Message from your driver',
      data: { bookingId: 'b1', messageId: 'm1' },
    });
    expect(push.body.length).toBeLessThanOrEqual(120);
  });

  it('alerts admins about a new SOS and tells the raiser when it is handled', () => {
    expect(
      messageFor('sos:new', {
        id: 's1',
        raisedByRole: 'driver',
        raisedByName: 'Saeed',
        bookingNumber: 'TN-7',
      }),
    ).toMatchObject({
      type: 'sos.new',
      title: 'SOS from a driver',
      body: expect.stringContaining('TN-7'),
    });
    expect(messageFor('sos:updated', { id: 's1', status: 'acknowledged' })).toMatchObject({
      type: 'sos.acknowledged',
      title: 'Help is on the way',
    });
    expect(
      messageFor('sos:updated', { id: 's1', status: 'resolved', resolution: 'Police attended' }),
    ).toMatchObject({ title: 'SOS resolved', body: 'Police attended' });
  });
});

describe('messageFor', () => {
  it('turns booking status events into customer notifications', () => {
    expect(messageFor('booking:updated', { bookingId: 'b1', status: 'driver_arrived' })).toEqual({
      type: 'booking.driver_arrived',
      title: 'Driver has arrived',
      body: 'Your tow truck is at the pickup point.',
      data: { bookingId: 'b1', status: 'driver_arrived' },
    });
  });

  it('skips statuses and events that are not worth a push', () => {
    expect(messageFor('booking:updated', { bookingId: 'b1', status: 'searching' })).toBeNull();
    expect(messageFor('trip:location', { lat: 1, lng: 2 })).toBeNull();
    expect(messageFor('offer:closed', { offerId: 'o1' })).toBeNull();
    expect(messageFor('kyc:updated', { kycStatus: 'pending' })).toBeNull();
  });

  it('describes new offers with the pickup address, and copes with missing fields', () => {
    expect(
      messageFor('offer:new', {
        offerId: 'o1',
        bookingId: 'b1',
        pickup: { address: 'JLT Cluster D' },
      }),
    ).toMatchObject({
      type: 'offer.new',
      body: expect.stringContaining('JLT Cluster D'),
      data: { offerId: 'o1', bookingId: 'b1' },
    });
    expect(messageFor('offer:new', null)).toMatchObject({
      body: expect.stringContaining('nearby'),
      data: { offerId: '', bookingId: '' },
    });
  });

  it('covers KYC decisions and disputes', () => {
    expect(messageFor('kyc:updated', { kycStatus: 'approved' })?.title).toBe('You are approved');
    expect(messageFor('kyc:updated', { kycStatus: 'rejected' })?.type).toBe('kyc.rejected');
    expect(
      messageFor('dispute:updated', {
        disputeId: 'd1',
        bookingId: 'b1',
        bookingNumber: 'TN-1',
        status: 'resolved',
      }),
    ).toMatchObject({
      type: 'dispute.resolved',
      title: 'Dispute resolved',
      body: expect.stringContaining('TN-1'),
    });
  });
});
