import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter, ErrorResponseBody } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const reply = vi.fn();
  const adapterHost = {
    httpAdapter: {
      reply,
      getRequestUrl: () => '/api/v1/bookings',
      getRequestMethod: () => 'POST',
    },
  } as unknown as HttpAdapterHost;
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter(adapterHost).catch(exception, host);
  const [, body, status] = reply.mock.calls[0] as [unknown, ErrorResponseBody, number];
  return { body, status };
}

const pgError = (code: string) =>
  new QueryFailedError('INSERT INTO users ...', [], Object.assign(new Error('pg'), { code }));

describe('AllExceptionsFilter', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('keeps the status and message of HTTP exceptions', () => {
    const { body, status } = run(new NotFoundException('Booking not found'));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Booking not found',
      path: '/api/v1/bookings',
    });
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('passes validation messages through as a list', () => {
    const { body, status } = run(
      new BadRequestException(['phone must be a valid UAE mobile number']),
    );
    expect(status).toBe(400);
    expect(body.message).toEqual(['phone must be a valid UAE mobile number']);
  });

  it('maps a unique-constraint violation to 409 without leaking SQL', () => {
    const { body, status } = run(pgError('23505'));
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(JSON.stringify(body)).not.toContain('INSERT');
  });

  it('maps an invalid uuid to 400', () => {
    expect(run(pgError('22P02')).status).toBe(400);
  });

  it('hides unexpected errors behind a generic 500', () => {
    const { body, status } = run(new Error('connection string postgres://user:pw@db leaked'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });

  it('treats unknown database errors as 500', () => {
    expect(run(pgError('XX000')).status).toBe(500);
  });
});

describe('AllExceptionsFilter details', () => {
  it('keeps structured detail from deliberate exceptions (e.g. failed health checks)', () => {
    const health = { status: 'error', error: { redis: { status: 'down' } } };
    const { body, status } = run(new ServiceUnavailableException(health));
    expect(status).toBe(503);
    expect(body.details).toEqual(health);
  });
});

describe('AllExceptionsFilter extra fields', () => {
  it('passes extra fields of an exception body through as details', () => {
    const { body, status } = run(
      new HttpException({ message: 'Please wait 30s', retryAfterSeconds: 30 }, 429),
    );
    expect(status).toBe(429);
    expect(body.message).toBe('Please wait 30s');
    expect(body.details).toEqual({ retryAfterSeconds: 30 });
  });

  it('adds no details when there is nothing extra', () => {
    expect(run(new NotFoundException('nope')).body.details).toBeUndefined();
  });
});
