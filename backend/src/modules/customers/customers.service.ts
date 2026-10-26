import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { CustomerProfileView, UpdateCustomerProfileDto } from './customer.dto.js';
import { Customer } from './entities/customer.entity.js';

@Injectable()
export class CustomersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  getProfile(userId: string): Promise<CustomerProfileView> {
    return this.dataSource.transaction(async (em) => {
      const customer = await this.findCustomer(em, userId);
      const user = await em.findOneByOrFail(User, { id: userId });
      return CustomerProfileView.from(user, customer);
    });
  }

  updateProfile(userId: string, dto: UpdateCustomerProfileDto): Promise<CustomerProfileView> {
    return this.dataSource.transaction(async (em) => {
      const customer = await this.findCustomer(em, userId);
      const user = await this.users.updateContact(em, userId, dto);
      if (dto.defaultPaymentMethod !== undefined) {
        await em.update(Customer, customer.id, { defaultPaymentMethod: dto.defaultPaymentMethod });
        customer.defaultPaymentMethod = dto.defaultPaymentMethod;
      }
      return CustomerProfileView.from(user, customer);
    });
  }

  private async findCustomer(em: EntityManager, userId: string): Promise<Customer> {
    const customer = await em.findOneBy(Customer, { userId });
    if (!customer) throw new NotFoundException('Customer profile not found.');
    return customer;
  }
}
