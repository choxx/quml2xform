import { Module } from '@nestjs/common';
import { QumlToOdkService } from './quml-to-odk.service';
import { QumlToOdkController } from './quml-to-odk.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  controllers: [QumlToOdkController],
  providers: [QumlToOdkService],
  imports: [HttpModule],
})
export class QumlToOdkModule {}
