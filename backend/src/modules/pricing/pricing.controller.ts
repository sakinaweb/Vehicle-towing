import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { PricingService, TariffView } from './pricing.service.js';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Public so the app can show "from AED …" before sign-in. Quotes are computed per trip. */
  @Public()
  @Get('tariffs')
  @ApiOperation({ summary: 'Current tariff per tow type (fils)' })
  @ApiOkResponse({ type: [TariffView] })
  tariffs(): Promise<TariffView[]> {
    return this.pricing.activeTariffs();
  }
}
