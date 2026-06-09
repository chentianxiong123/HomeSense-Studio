import { BadRequestException, Injectable } from '@nestjs/common'
import { AlistService } from '../alist/alist.service'
import type {
  AlistCopyInput,
  AlistDriverHealthResult,
  AlistDriverListResult,
  AlistDriverProps,
  AlistDriverGetResult,
  AlistDriverMutationResult,
  AlistGetInput,
  AlistListInput,
  AlistRemoveInput,
} from '../alist/alist.types'
import { StorageMountService } from './storage-mount.service'

@Injectable()
export class StorageService {
  constructor(
    private readonly mounts: StorageMountService,
    private readonly alist: AlistService,
  ) {}

  health(): Promise<AlistDriverHealthResult> {
    return this.alist.healthForProps(this.buildDriverProps())
  }

  list(input: AlistListInput): Promise<AlistDriverListResult> {
    this.ensureMounts()
    return this.alist.listForProps(this.buildDriverProps(), input)
  }

  get(input: AlistGetInput): Promise<AlistDriverGetResult> {
    this.ensureMounts()
    return this.alist.getForProps(this.buildDriverProps(), input)
  }

  remove(input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    this.ensureMounts()
    return this.alist.removeForProps(this.buildDriverProps(), input)
  }

  copy(input: AlistCopyInput): Promise<AlistDriverMutationResult> {
    this.ensureMounts()
    return this.alist.copyForProps(this.buildDriverProps(), input)
  }

  private buildDriverProps(): AlistDriverProps {
    const mounts = this.mounts.list().mounts
    return {
      mounts: mounts.map((mount) => ({
        path: mount.virtual_path,
        label: mount.name,
        driver: mount.driver,
        authorization_id: mount.authorization_id,
        readonly: mount.readonly,
        ...mount.props,
      })),
    }
  }

  private ensureMounts(): void {
    if (this.mounts.list().mounts.length === 0) {
      throw new BadRequestException('No storage mounts configured')
    }
  }
}
