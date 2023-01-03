import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QumlToOdkModule } from './quml-to-odk/quml-to-odk.module';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { FormService } from './form-upload/form.service';
import { FormUploadModule } from './form-upload/form-upload.module';

@Module({
  imports: [
    QumlToOdkModule,
    HttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    FormUploadModule,
  ],
  controllers: [AppController],
  providers: [AppService, FormService],
})
export class AppModule {}
