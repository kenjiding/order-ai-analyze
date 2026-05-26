import type {
  ConcreteLossScope,
  ExceptionCategoryEntity,
  ExceptionSampleEntity,
  LossScope,
  TrackEvent,
} from './types'

export type OrderExceptionRepository = {
  listCategories(): Promise<ExceptionCategoryEntity[]>
  createCategory(
    name: string,
    description: string,
    lossScope: ConcreteLossScope,
  ): Promise<ExceptionCategoryEntity>
  updateCategory(
    id: string,
    patch: { name?: string; description?: string; lossScope?: LossScope },
  ): Promise<void>
  deleteCategory(id: string): Promise<void>
  listSamplesByCategory(categoryId: string): Promise<ExceptionSampleEntity[]>
  upsertSample(input: {
    categoryId: string
    orderNo: string
    tracks: TrackEvent[]
  }): Promise<ExceptionSampleEntity>
  updateSampleTracks(sampleId: string, tracks: TrackEvent[]): Promise<ExceptionSampleEntity>
  deleteSample(sampleId: string): Promise<void>
  listAllSamples(): Promise<ExceptionSampleEntity[]>
}
