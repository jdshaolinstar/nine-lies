class Car():
    def __init__(self):
        self.fuel_amount=0
        self.speed=0
        self.damage=0
        print("made a car")

    def add_damage(self,damage_amount):
        if self.damage-damage_amount<=0:
            self.damage=0
        else:
            self.damage -=damage_amount

    def reduce_fuel(self,fuel_amount):
        if self.fuel_amount-fuel_amount<=0:
            self.fuel_amount=0
            print("a"+str(self.fuel_amount))
        else:
            self.fuel_amount -=fuel_amount
            print("b"+str(self.fuel_amount))

        if fuel_amount <=0:
            self.stop_car()
        print("c"+str(self.fuel_amount))
    
    def stop_car(self):
        self.speed=0

    def get_speed(self):
        self.reduce_fuel(10)
        print(self.speed)

car = Car()

car.speed=100
print(car.speed)
car.reduce_fuel(100)
print(car.speed)
