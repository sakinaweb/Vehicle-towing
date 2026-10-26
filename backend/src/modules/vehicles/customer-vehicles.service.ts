import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { BookingStatus } from '../../common/enums.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { isUniqueViolation } from '../users/users.service.js';
import { CustomerVehicle } from './entities/customer-vehicle.entity.js';
import {
  CreateCustomerVehicleDto,
  CustomerVehicleView,
  UpdateCustomerVehicleDto,
} from './vehicle.dto.js';

export const MAX_VEHICLES_PER_CUSTOMER = 10;
export const FINAL_BOOKING_STATUSES = [BookingStatus.Completed, BookingStatus.Cancelled];

@Injectable()
export class CustomerVehiclesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(userId: string): Promise<CustomerVehicleView[]> {
    return this.dataSource.transaction(async (em) => {
      const customer = await this.customerOf(em, userId);
      const vehicles = await em.find(CustomerVehicle, {
        where: { customerId: customer.id },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      });
      return vehicles.map((v) => CustomerVehicleView.from(v));
    });
  }

  get(userId: string, vehicleId: string): Promise<CustomerVehicleView> {
    return this.dataSource.transaction(async (em) =>
      CustomerVehicleView.from(await this.ownVehicle(em, userId, vehicleId)),
    );
  }

  create(userId: string, dto: CreateCustomerVehicleDto): Promise<CustomerVehicleView> {
    return this.dataSource.transaction(async (em) => {
      const customer = await this.customerOf(em, userId, { lock: true });
      const count = await em.countBy(CustomerVehicle, { customerId: customer.id });
      if (count >= MAX_VEHICLES_PER_CUSTOMER) {
        throw new ConflictException(
          `You can register up to ${MAX_VEHICLES_PER_CUSTOMER} vehicles. Remove one to add another.`,
        );
      }
      // The first vehicle is the default automatically.
      const isDefault = count === 0 || dto.isDefault === true;
      if (isDefault) await this.clearDefault(em, customer.id);
      const vehicle = await this.savePlateSafe(
        em,
        em.create(CustomerVehicle, {
          ...dto,
          color: dto.color ?? null,
          isDefault,
          customerId: customer.id,
        }),
      );
      return CustomerVehicleView.from(vehicle);
    });
  }

  update(
    userId: string,
    vehicleId: string,
    dto: UpdateCustomerVehicleDto,
  ): Promise<CustomerVehicleView> {
    return this.dataSource.transaction(async (em) => {
      const vehicle = await this.ownVehicle(em, userId, vehicleId, { lock: true });
      if (dto.isDefault === false && vehicle.isDefault) {
        throw new ConflictException('Choose another vehicle as default instead.');
      }
      if (dto.isDefault === true && !vehicle.isDefault) {
        await this.clearDefault(em, vehicle.customerId);
      }
      if (dto.category !== undefined && dto.category !== vehicle.category) {
        await this.assertNoActiveBooking(em, vehicle.id, 'change the type of');
      }
      Object.assign(vehicle, dto);
      return CustomerVehicleView.from(await this.savePlateSafe(em, vehicle));
    });
  }

  /** Soft delete: past bookings keep their vehicle; the plate can be registered again. */
  remove(userId: string, vehicleId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const vehicle = await this.ownVehicle(em, userId, vehicleId, { lock: true });
      await this.assertNoActiveBooking(em, vehicle.id, 'remove');
      await em.update(CustomerVehicle, vehicle.id, { isDefault: false });
      await em.softDelete(CustomerVehicle, vehicle.id);
      if (vehicle.isDefault) {
        const next = await em.findOne(CustomerVehicle, {
          where: { customerId: vehicle.customerId },
          order: { createdAt: 'ASC' },
        });
        if (next) await em.update(CustomerVehicle, next.id, { isDefault: true });
      }
    });
  }

  /** For other modules (bookings): a live vehicle owned by this customer, else 404. */
  async findOwned(
    em: EntityManager,
    customerId: string,
    vehicleId: string,
  ): Promise<CustomerVehicle> {
    const vehicle = await em.findOneBy(CustomerVehicle, { id: vehicleId, customerId });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    return vehicle;
  }

  async customerOf(
    em: EntityManager,
    userId: string,
    opts: { lock?: boolean } = {},
  ): Promise<Customer> {
    const customer = await em.findOne(Customer, {
      where: { userId },
      // Serialises concurrent writes for one customer (vehicle cap, default flag).
      ...(opts.lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!customer) throw new NotFoundException('Customer profile not found.');
    return customer;
  }

  /** Another customer's vehicle is reported as not found (no enumeration). */
  private async ownVehicle(
    em: EntityManager,
    userId: string,
    vehicleId: string,
    opts: { lock?: boolean } = {},
  ): Promise<CustomerVehicle> {
    const customer = await this.customerOf(em, userId, opts);
    return this.findOwned(em, customer.id, vehicleId);
  }

  private async clearDefault(em: EntityManager, customerId: string): Promise<void> {
    await em.update(CustomerVehicle, { customerId, isDefault: true }, { isDefault: false });
  }

  private async assertNoActiveBooking(em: EntityManager, vehicleId: string, verb: string) {
    const active = await em.countBy(Booking, {
      customerVehicleId: vehicleId,
      status: Not(In(FINAL_BOOKING_STATUSES)),
    });
    if (active > 0) {
      throw new ConflictException(
        `You can't ${verb} a vehicle while it has an active tow request.`,
      );
    }
  }

  private async savePlateSafe(
    em: EntityManager,
    vehicle: CustomerVehicle,
  ): Promise<CustomerVehicle> {
    try {
      return await em.save(vehicle);
    } catch (err) {
      if (isUniqueViolation(err, 'uq_customer_vehicles_plate')) {
        throw new ConflictException('You have already registered a vehicle with this plate.');
      }
      throw err;
    }
  }
}
