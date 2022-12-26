import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, map } from 'rxjs';
import AdmZip = require('adm-zip');
import { exec } from 'child_process';
import { FormService } from './form-upload/form.service';

@Injectable()
export class AppService {
  private readonly hasuraGraphqlUrl;
  private readonly hasuraGraphqlSecret;
  private readonly uploadFormsToAggregate: boolean;

  protected readonly logger = new Logger(AppService.name); // logger instance

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly formService: FormService,
  ) {
    this.hasuraGraphqlUrl = configService.get<string>('HASURA_GRAPHQL_URL');
    this.hasuraGraphqlSecret = configService.get<string>('HASURA_ADMIN_SECRET');
    this.uploadFormsToAggregate =
      configService.get<string>('UPLOAD_FORMS', 'FALSE') === 'TRUE';
  }

  getHello(): string {
    return 'Hello World!';
  }

  async hasuraGraphQLCall(
    data,
    url: string = this.hasuraGraphqlUrl,
    headers = {
      'x-hasura-admin-secret': this.hasuraGraphqlSecret,
      'Content-Type': 'application/json',
    },
  ) {
    return await lastValueFrom(
      this.httpService
        .post(url, data, {
          headers: headers,
        })
        .pipe(
          map((res) => {
            return res.status == 200 ? res.data : null;
          }),
        ),
    );
  }

  public async convertExcelToOdkForm(
    inputFile: string,
    outputFile: string,
  ): Promise<boolean> {
    // Make sure the binary is installed system wide; Ref: https://github.com/XLSForm/pyxform
    const command = 'xls2xform ' + inputFile + ' ' + outputFile;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return await new Promise(function (resolve, reject) {
      exec(command, (error) => {
        if (error) {
          self.logger.error('Error generating ODK form: ', error);
          reject(false);
          return;
        }
        resolve(true);
      });
    })
      .then((success: boolean) => {
        return success;
      })
      .catch((failed: boolean) => {
        return failed;
      });
  }

  async xslxToOdk(file: Express.Multer.File) {
    this.logger.log('Processing zip file..');
    const zip = new AdmZip(file.path);
    if (!zip.test()) {
      this.logger.error('Invalid zip uploaded.');
      throw new UnprocessableEntityException('Not a valid zip file.');
    }

    const targetPath: string = './gen/zip/extracted/' + file.filename;
    zip.extractAllTo(targetPath, true);
    this.logger.log(`Zip extracted to: ${targetPath}`);

    const formImageFiles: Array<string> = [];
    zip.forEach((zipEntry) => {
      if (zipEntry.name != '' && zipEntry.entryName.includes('images/')) {
        // it's an image
        this.logger.log(zipEntry);
        formImageFiles.push(targetPath + '/' + zipEntry.entryName);
      }
    });

    const inputFile = targetPath + '/form.xlsx';
    const odkFormFile = targetPath + '/form.xml';
    await this.convertExcelToOdkForm(inputFile, odkFormFile);
    this.logger.log(`XML file generated & stored at: ${odkFormFile}`);

    let error = false;
    let errorMsg = '';
    if (this.uploadFormsToAggregate) {
      // if form upload to aggregate allowed
      this.logger.debug(`Uploading form.. Image files:`, formImageFiles);
      const formUploadResponse = await this.formService.uploadForm(
        odkFormFile,
        formImageFiles,
      );
      if (
        formUploadResponse &&
        formUploadResponse.status &&
        formUploadResponse.status === 'UPLOADED'
      ) {
        //
      } else {
        error = true;
        errorMsg = 'Form Upload Failed!';
        this.logger.error(`Form Upload error..`, formUploadResponse);
      }
    }
    return {
      xlsxFile: inputFile,
      odkFile: odkFormFile,
      error: error,
      errorMsg: errorMsg,
    };
  }
}
