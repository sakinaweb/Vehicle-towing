import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TowType } from '../../common/enums.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { LatLng } from '../locations/geo.js';
import { RoutingService } from '../locations/routing.service.js';
import { FareBreakdown, TariffInput } from '../pricing/fare.calculator.js';
import { PricingService } from '../pricing/pricing.service.js';
import { CustomerVehiclesService } from '../vehicles/customer-vehicles.service.js';
import { isTowTypeCompatible, MAX_TRIP_METERS, MIN_TRIP_METERS } from './booking.rules.js';
import { QuoteRequestDto, QuoteView } from './booking.dto.js';

/** How long a price is guaranteed for. */
export const QUOTE_TTL_SECONDS = 15 * 60;

export interface PlacedLocation extends LatLng {
  address: string;
}

/** What is stored in Redis and later snapshotted onto the booking. */
export interface StoredQuote {
  id: string;
  customerId: string;
  vehicleId: string;
  towType: TowType;
  pickup: PlacedLocation;
  dropoff: PlacedLocation;
  distanceMeters: number;
  estimatedDurationSeconds: number;
  distanceSource: string;
  pricingRuleId: string;
  tariff: TariffInput;
  fare: FareBreakdown;
  quotedAt: string;
  expiresAt: string;
}

const TOW_LABEL: Record<TowType, string> = {
  [TowType.Flatbed]: 'A flatbed',
  [TowType.WheelLift]: 'A wheel-lift truck',
  [TowType.BikeCarrier]: 'A motorbike carrier',
};

@Injectable()
export class QuotesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly vehicles: CustomerVehiclesService,
    private readonly routing: RoutingService,
    private readonly pricing: PricingService,
  ) {}

  async create(userId: string, dto: QuoteRequestDto): Promise<QuoteView> {
    const em = this.dataSource.manager;
    const customer = await this.vehicles.customerOf(em, userId);
    const vehicle = await this.vehicles.findOwned(em, customer.id, dto.vehicleId);

    if (!isTowTypeCompatible(vehicle.category, dto.towType)) {
      throw new BadRequestException(
        `${TOW_LABEL[dto.towType]} can't carry a ${vehicle.category}. Choose another tow type.`,
      );
    }
    for (const [label, point] of [
      ['Pickup', dto.pickup],
      ['Drop-off', dto.dropoff],
    ] as const) {
      if (!(await this.routing.isInUae(point))) {
        throw new BadRequestException(
          `${label} location is outside the TowNow service area (UAE).`,
        );
      }
    }

    const route = await this.routing.estimate(dto.pickup, dto.dropoff);
    if (route.distanceMeters < MIN_TRIP_METERS) {
      throw new BadRequestException(
        'Pickup and drop-off are the same place. Check the drop-off pin.',
      );
    }
    if (route.distanceMeters > MAX_TRIP_METERS) {
      throw new BadRequestException(
        `Tows longer than ${MAX_TRIP_METERS / 1000} km can't be booked in the app. Contact support.`,
      );
    }

    const now = new Date();
    const { rule, fare } = await this.pricing.price(dto.towType, route.distanceMeters, now);
    const quote: StoredQuote = {
      id: randomUUID(),
      customerId: customer.id,
      vehicleId: vehicle.id,
      towType: dto.towType,
      pickup: { lat: dto.pickup.lat, lng: dto.pickup.lng, address: dto.pickup.address },
      dropoff: { lat: dto.dropoff.lat, lng: dto.dropoff.lng, address: dto.dropoff.address },
      distanceMeters: route.distanceMeters,
      estimatedDurationSeconds: route.durationSeconds,
      distanceSource: route.source,
      pricingRuleId: rule.id,
      tariff: {
        baseFareFils: rule.baseFareFils,
        perKmFils: rule.perKmFils,
        minimumFareFils: rule.minimumFareFils,
        towTypeSurchargeFils: rule.towTypeSurchargeFils,
        nightSurchargeFils: rule.nightSurchargeFils,
        vatRateBps: rule.vatRateBps,
        currency: rule.currency,
      },
      fare,
      quotedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
    await this.redis.set(this.key(quote.id), JSON.stringify(quote), 'EX', QUOTE_TTL_SECONDS);
    return QuotesService.toView(quote);
  }

  async find(quoteId: string): Promise<StoredQuote | null> {
    const raw = await this.redis.get(this.key(quoteId));
    return raw ? (JSON.parse(raw) as StoredQuote) : null;
  }

  async discard(quoteId: string): Promise<void> {
    await this.redis.del(this.key(quoteId));
  }

  static toView(q: StoredQuote): QuoteView {
    return {
      quoteId: q.id,
      expiresAt: new Date(q.expiresAt),
      vehicleId: q.vehicleId,
      towType: q.towType,
      pickup: q.pickup,
      dropoff: q.dropoff,
      distanceMeters: q.distanceMeters,
      estimatedDurationSeconds: q.estimatedDurationSeconds,
      distanceSource: q.distanceSource,
      fare: q.fare,
    };
  }

  private key(id: string): string {
    return `booking-quote:${id}`;
  }
}
