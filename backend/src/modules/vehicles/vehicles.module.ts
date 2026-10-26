import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerVehiclesController } from './customer-vehicles.controller.js';
import { CustomerVehiclesService } from './customer-vehicles.service.js';
import { CustomerVehicle } from './entities/customer-vehicle.entity.js';

/** Customer-registered vehicles that can be towed. */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerVehicle])],
  controllers: [CustomerVehiclesController],
  providers: [CustomerVehiclesService],
  exports: [TypeOrmModule, CustomerVehiclesService],
})
export class VehiclesModule {}
