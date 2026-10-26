import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums.js';
import { User } from './entities/user.entity.js';

/** Public representation of a user. Entities are never serialised directly. */
export class UserView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+971501234567' }) phone!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty() createdAt!: Date;

  static from(user: User): UserView {
    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
      createdAt: user.createdAt,
    };
  }
}
