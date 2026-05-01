import { toIdString } from './toIdString';

export class CategoryId {
    private readonly value_: string;

    public constructor(value: string) {
        this.value_ = toIdString(value);
    }

    public static from(value: string): CategoryId {
        return new CategoryId(value);
    }

    public toString(): string {
        return this.value_;
    }

    public value(): string {
        return this.value_;
    }

    public equals(other: CategoryId): boolean {
        return this.value_ === other.value_;
    }

    public compare(other: CategoryId): number {
        return this.value_.localeCompare(other.value_);
    }
}