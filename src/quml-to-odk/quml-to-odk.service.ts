import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GenerateFormDto } from './dto/generate-form.dto';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, map } from 'rxjs';
import { exec } from 'child_process';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { McqParserService } from './services/mcq-parser.service';
import { QuestionTypesEnum } from './enums/question-types.enum';
import { FormService } from './form-upload/form.service';

@Injectable()
export class QumlToOdkService {
  private readonly questionBankUrl: string;
  private readonly questionDetailsUrl: string;
  private readonly xlsxFilesPath: string;
  private readonly odkFormsPath: string;

  private readonly logger = new Logger(QumlToOdkService.name); // logger instance

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly formService: FormService,
  ) {
    this.questionBankUrl = configService.get<string>(
      'QUML_ODK_QUESTION_BANK_URL',
    );
    this.questionDetailsUrl = configService.get<string>(
      'QUML_ODK_QUESTION_BANK_DETAILS_URL',
    );
    this.xlsxFilesPath = configService.get<string>(
      'QUML_XLSX_FILE_STORAGE_PATH',
    );
    this.odkFormsPath = configService.get<string>(
      'QUML_ODK_FORM_FILE_STORAGE_PATH',
    );
  }

  public async generate(filters: GenerateFormDto) {
    const questions = await this.fetchQuestions(filters);
    if (questions.result && questions.result.count) {
      const templateFileName = uuid(); // initialize the template name
      let service;

      // based on question type, we'll use different parsers
      switch (filters.qType) {
        case QuestionTypesEnum.MCQ:
          service = new McqParserService(); // create the instance
          break;
        default:
          throw BadRequestException; // ideally this part should be handled at validation level itself
      }

      const xlsxFormFile = service.createForm(
        questions,
        filters,
        this.xlsxFilesPath + '/' + templateFileName + '.xlsx',
      );

      const odkFormFile = this.odkFormsPath + '/' + templateFileName + '.xml';
      await this.convertExcelToOdkForm(xlsxFormFile, odkFormFile);
      console.log(await this.formService.uploadForm(odkFormFile));
      return {
        xlsxFile: xlsxFormFile,
        odkFile: odkFormFile,
      };
    }
    this.logger.debug(
      'Please ensure there are questions available for the matching combination',
    );
    return 'Please ensure there are questions available for the matching combination';
  }

  private async fetchQuestions(filters: GenerateFormDto): Promise<any> {
    const requestBody = {
      request: {
        filters: {
          se_boards: filters.boards,
          gradeLevel: filters.grades,
          subject: filters.subjects,
          qType: filters.qType,
          topic: filters.competencies,
        },
      },
    };

    const response = await lastValueFrom(
      this.httpService
        .post(this.questionBankUrl, requestBody, {
          headers: { 'Content-Type': 'application/json' },
        })
        .pipe(
          map((res) => {
            return res.status == 200 ? res.data : null;
          }),
        ),
    );

    let questionIdentifiers = [];
    // if there are questions available and requested random questions count is > available questions from question bank
    if (response.result.count > filters.randomQuestionsCount) {
      // let's sort the available questions in random order
      const randomQuestionsList = response.result.Question.sort(
        () => Math.random() - 0.5,
      );
      questionIdentifiers = randomQuestionsList
        .slice(0, filters.randomQuestionsCount)
        .map((obj) => {
          return obj.identifier;
        });
      this.logger.debug(
        'Random question identifiers from ' +
          '(' +
          filters.randomQuestionsCount +
          '/' +
          response.result.count +
          '):\n' +
          questionIdentifiers,
      );
    } else {
      // either the API failed or less questions available than the required random count
      console.debug(
        'either the API failed or less questions available than the required random count',
      );
    }

    let questions = [];
    if (questionIdentifiers.length) {
      questions = await this.fetchQuestionDetails(questionIdentifiers);
    }
    return questions;
  }

  private async fetchQuestionDetails(identifiers) {
    return lastValueFrom(
      this.httpService
        .post(
          this.questionDetailsUrl,
          {
            request: {
              search: {
                identifier: identifiers,
              },
            },
          },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
        .pipe(
          map((res) => {
            return res.status == 200 ? res.data : null;
          }),
        ),
    );
  }

  private async convertExcelToOdkForm(
    inputFile: string,
    outputFile: string,
  ): Promise<boolean> {
    // Make sure the binary is installed system wide; Ref: https://github.com/XLSForm/pyxform
    const command = 'xls2xform ' + inputFile + ' ' + outputFile;
    return await new Promise(function (resolve, reject) {
      exec(command, (error) => {
        if (error) {
          console.log(error);
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

  public static cleanHtml(str: string, nbspAsLineBreak = false) {
    // Remove HTML characters since we are not converting HTML to PDF.
    return str
      .replace(/<\/?(?!\bstrong\b)\b\w+\b>/g, '')
      .replace(/&nbsp;/g, nbspAsLineBreak ? '\n' : '');
  }
}
