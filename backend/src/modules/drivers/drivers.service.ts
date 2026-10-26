import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { isUniqueViolation, UsersService } from '../users/users.service.js';
import {
  CreateTowTruckDto,
  DriverProfileView,
  TowTruckView,
  UpdateDriverProfileDto,
  UpdateTowTruckDto,
} from './driver.dto.js';
import { Driver } from './entities/driver.entity.js';
import { TowTruck } from './entities/tow-truck.entity.js';

/** A driver partner may register a small fleet; more needs an operator (fleet) account. */
export const MAX_TRUCKS_PER_DRIVER = 5;

@Injectable()
export class DriversService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  getProfile(userId: string): Promise<DriverProfileView> {
    return this.dataSource.transaction(async (em) => {
      const driver = await this.findDriver(em, userId);
      return this.view(em, userId, driver);
    });
  }

  updateProfile(userId: string, dto: UpdateDriverProfileDto): Promise<DriverProfileView> {
    return this.dataSource.transaction(async (em) => {
      const driver = await this.findDriver(em, userId);
      await this.users.updateContact(em, userId, dto);
      if (dto.experienceYears !== undefined) {
        await em.update(Driver, driver.id, { experienceYears: dto.experienceYears });
        driver.experienceYears = dto.experienceYears;
      }
      return this.view(em, userId, driver);
    });
  }

  listTrucks(userId: string): Promise<TowTruckView[]> {
    return this.dataSource.transaction(async (em) => {
      const driver = await this.findDriver(em, userId);
      const trucks = await this.trucksOf(em, driver.id);
      return trucks.map((t) => TowTruckView.from(t));
    });
  }

  addTruck(userId: string, dto: CreateTowTruckDto): Promise<TowTruckView> {
    return this.dataSource.transaction(async (em) => {
      const driver = await this.findDriver(em, userId, { lock: true });
      const count = await em.countBy(TowTruck, { driverId: driver.id });
      if (count >= MAX_TRUCKS_PER_DRIVER) {
        throw new ConflictException(
          `A driver account can register up to ${MAX_TRUCKS_PER_DRIVER} tow trucks.`,
        );
      }
      const truck = await this.savePlateSafe(
        em,
        em.create(TowTruck, { ...dto, driverId: driver.id }),
      );
      return TowTruckView.from(truck);
    });
  }

  updateTruck(userId: string, truckId: string, dto: UpdateTowTruckDto): Promise<TowTruckView> {
    return this.dataSource.transaction(async (em) => {
      const truck = await this.findOwnTruck(em, userId, truckId);
      Object.assign(truck, dto);
      return TowTruckView.from(await this.savePlateSafe(em, truck));
    });
  }

  removeTruck(userId: string, truckId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const truck = await this.findOwnTruck(em, userId, truckId);
      try {
        await em.delete(TowTruck, truck.id);
      } catch (err) {
        if (
          err instanceof QueryFailedError &&
          (err.driverError as { code?: string }).code === '23503'
        ) {
          throw new ConflictException(
            'This truck has job history and cannot be deleted. Deactivate it instead.',
          );
        }
        throw err;
      }
    });
  }

  private async view(
    em: EntityManager,
    userId: string,
    driver: Driver,
  ): Promise<DriverProfileView> {
    const user = await em.findOneByOrFail(User, { id: userId });
    return DriverProfileView.from(user, driver, await this.trucksOf(em, driver.id));
  }

  private trucksOf(em: EntityManager, driverId: string): Promise<TowTruck[]> {
    return em.find(TowTruck, { where: { driverId }, order: { createdAt: 'ASC' } });
  }

  private async findDriver(
    em: EntityManager,
    userId: string,
    opts: { lock?: boolean } = {},
  ): Promise<Driver> {
    const driver = await em.findOne(Driver, {
      where: { userId },
      // Serialises concurrent "add truck" calls so the fleet cap can't be exceeded.
      ...(opts.lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    return driver;
  }

  /** Another driver's truck is reported as not found, never as forbidden (no enumeration). */
  private async findOwnTruck(
    em: EntityManager,
    userId: string,
    truckId: string,
  ): Promise<TowTruck> {
    const driver = await this.findDriver(em, userId);
    const truck = await em.findOneBy(TowTruck, { id: truckId, driverId: driver.id });
    if (!truck) throw new NotFoundException('Tow truck not found.');
    return truck;
  }

  private async savePlateSafe(em: EntityManager, truck: TowTruck): Promise<TowTruck> {
    try {
      return await em.save(truck);
    } catch (err) {
      if (isUniqueViolation(err, 'uq_tow_trucks_plate')) {
        throw new ConflictException('A tow truck with this plate is already registered.');
      }
      throw err;
    }
  }
}
